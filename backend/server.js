const express = require('express');
const cors    = require('cors');
const http    = require('http');
// ─── Helper exclusivo para el proxy ESP32 — lee el body HTML ────
// Separado de httpGet (que descarta el body) porque el proxy necesita
// el contenido para inyectar el <base> tag.
function httpGetBody(ip, path, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://${ip}${path}`, { timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error',   (e) => reject(e));
    });
}

const { createProxyMiddleware } = require('http-proxy-middleware');
const db = require('./database');

// ─── Helper: ping HTTP con http nativo (sin dependencias externas) ─
// Apunta a /ping en lugar de la raíz para que el ESP32 responda
// rápido (PONG o JSON liviano) sin tener que servir el HTML completo
// desde LittleFS, lo que puede demorar o fallar por timeout.
function httpGet(ip, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://${ip}/ping`, { timeout: timeoutMs }, (res) => {
            res.resume(); // consumir y descartar el body
            resolve({ status: res.statusCode });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error',   (e) => reject(e));
    });
}

const authRoutes       = require('./routes/auth');
const dispositivosRoutes = require('./routes/dispositivos');
const practicasRoutes  = require('./routes/practicas');
const usuariosRoutes   = require('./routes/usuarios');
const materiasRoutes   = require('./routes/materias');
const superadminRoutes = require('./routes/superadmin');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middlewares ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Rutas API ──────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/dispositivos', dispositivosRoutes);
app.use('/api/practicas',    practicasRoutes);
app.use('/api/usuarios',     usuariosRoutes);
app.use('/api/materias',     materiasRoutes);
app.use('/api/sa',           superadminRoutes);

// ─── Dashboard — resumen general (solo técnico) ──────────────────
const { verificarToken, soloTecnico } = require('./routes/auth');

app.get('/api/dashboard', verificarToken, soloTecnico, (req, res) => {
    const totalDispositivos = db.prepare('SELECT COUNT(*) AS n FROM dispositivos WHERE activo = 1').get().n;
    const onlineCount       = db.prepare('SELECT COUNT(*) AS n FROM dispositivos WHERE activo = 1 AND online = 1').get().n;
    const offlineCount      = totalDispositivos - onlineCount;
    const totalPracticas    = db.prepare('SELECT COUNT(*) AS n FROM practicas WHERE activo = 1').get().n;
    const totalUsuarios     = db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE activo = 1 AND rol = 'profesor'").get().n;
    const totalMaterias     = db.prepare('SELECT COUNT(*) AS n FROM materias WHERE activo = 1').get().n;

    const accesosHoy = db.prepare(`
        SELECT COUNT(*) AS n FROM logs
        WHERE accion = 'acceso_practica'
        AND fecha >= date('now')
    `).get().n;

    const ultimosAccesos = db.prepare(`
        SELECT l.fecha, u.nombre AS usuario, p.titulo AS practica, d.nombre AS dispositivo
        FROM logs l
        LEFT JOIN usuarios u   ON l.usuario_id    = u.id
        LEFT JOIN practicas p  ON l.practica_id   = p.id
        LEFT JOIN dispositivos d ON l.dispositivo_id = d.id
        WHERE l.accion = 'acceso_practica'
        ORDER BY l.fecha DESC LIMIT 5
    `).all();

    const dispositivosEstado = db.prepare(`
        SELECT d.nombre, d.ip, d.online, d.ultimo_ping, m.nombre AS materia
        FROM dispositivos d
        LEFT JOIN materias m ON d.materia_id = m.id
        WHERE d.activo = 1
        ORDER BY d.online DESC, d.nombre
    `).all();

    res.json({
        resumen: { totalDispositivos, onlineCount, offlineCount, totalPracticas, totalUsuarios, totalMaterias, accesosHoy },
        ultimosAccesos,
        dispositivosEstado
    });
});

// ─── Proxy dinámico hacia ESP32 ─────────────────────────────────
app.use('/esp32/:id', async (req, res, next) => {
    const { id } = req.params;

    const dispositivo = db.prepare(
        'SELECT * FROM dispositivos WHERE id = ?'
    ).get(id);

    if (!dispositivo) {
        return res.status(404).json({ error: 'Dispositivo no encontrado' });
    }

    if (!dispositivo.activo) {
        if (req.headers.accept && req.headers.accept.includes('text/html')) {
            return res.redirect(`/error-dispositivo.html?motivo=inactivo`);
        }
        return res.status(503).json({ error: 'Dispositivo inactivo' });
    }

    const ipBase  = `http://${dispositivo.ip}`;
    const baseTag = `<base href="${ipBase}/">`;

    // Ruta relativa al ESP32 (sin el prefijo /esp32/{id})
    const rutaRelativa = req.url.replace(`/esp32/${id}`, '') || '/';
    const urlEsp32     = `${ipBase}${rutaRelativa}`;

    // Para recursos no-HTML (CSS, JS, imágenes) usamos proxy directo
    const accept = req.headers['accept'] || '';
    const esHTML = rutaRelativa === '/' || rutaRelativa === '' ||
                   rutaRelativa.endsWith('.html') || rutaRelativa.endsWith('.htm') ||
                   accept.includes('text/html');

    if (!esHTML) {
        // Pasar los assets directo via proxy sin modificar
        req.url = rutaRelativa;
        return createProxyMiddleware({
            target: ipBase,
            changeOrigin: true,
            on: {
                error: (err, req, res) => {
                    res.status(502).send('');
                }
            }
        })(req, res, next);
    }

    // Para el HTML principal — fetch manual para poder inyectar <base>
    try {
        const r = await httpGetBody(dispositivo.ip, rutaRelativa || '/', 8000);

        // Inyectar <base> justo después de <head>
        let body = r.body;
        if (/<head/i.test(body)) {
            body = body.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
        } else {
            body = baseTag + body;
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(body);

    } catch (err) {
        console.error(`Error proxy ESP32 [${dispositivo.nombre}]:`, err.message);
        db.prepare('UPDATE dispositivos SET online = 0 WHERE id = ?').run(id);
        res.redirect(`/error-dispositivo.html?motivo=proxy_error`);
    }
});

// ─── Ping a un ESP32 ────────────────────────────────────────────
app.get('/api/ping/:id', async (req, res) => {
    const { id } = req.params;

    const dispositivo = db.prepare(
        'SELECT * FROM dispositivos WHERE id = ?'
    ).get(id);

    if (!dispositivo) {
        return res.status(404).json({ error: 'Dispositivo no encontrado' });
    }

    try {
        const r = await httpGet(dispositivo.ip, 5000);

        db.prepare('UPDATE dispositivos SET online = 1, ultimo_ping = ? WHERE id = ?')
          .run(new Date().toISOString(), id);

        res.json({ online: true, ip: dispositivo.ip, status: r.status });
    } catch(e) {
        db.prepare('UPDATE dispositivos SET online = 0 WHERE id = ?').run(id);
        res.json({ online: false, ip: dispositivo.ip, error: e.message });
    }
});

// ─── Health check ───────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Ping automático en background ──────────────────────────────
async function pingTodosLosDispositivos() {
    const dispositivos = db.prepare(
        'SELECT id, ip, nombre FROM dispositivos WHERE activo = 1'
    ).all();

    for (const disp of dispositivos) {
        try {
            await httpGet(disp.ip, 5000);
            db.prepare('UPDATE dispositivos SET online = 1, ultimo_ping = ? WHERE id = ?')
              .run(new Date().toISOString(), disp.id);
            console.log(`✅ Ping OK: ${disp.nombre} (${disp.ip})`);
        } catch(e) {
            console.log(`❌ Ping FAIL: ${disp.nombre} (${disp.ip}) — ${e.message}`);
            db.prepare('UPDATE dispositivos SET online = 0 WHERE id = ?').run(disp.id);
        }
    }
}

setTimeout(pingTodosLosDispositivos, 2000);
setInterval(pingTodosLosDispositivos, 30000);

// ─── Inicio ─────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Backend corriendo en puerto ${PORT}`);
});
