const express = require('express');
const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const db      = require('../database');
const { verificarToken, soloSuperAdmin } = require('./auth');

const router = express.Router();

// Helper ping nativo
function httpGet(ip, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://${ip}`, { timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error',   (e) => reject(e));
    });
}

// ── GET /api/sa/stats — estadísticas avanzadas ────────────────────
router.get('/stats', verificarToken, soloSuperAdmin, (req, res) => {
    const stats = {
        usuarios: {
            total:       db.prepare("SELECT COUNT(*) AS n FROM usuarios").get().n,
            superadmins: db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol='superadmin' AND activo=1").get().n,
            tecnicos:    db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol='tecnico' AND activo=1").get().n,
            profesores:  db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol='profesor' AND activo=1").get().n,
            inactivos:   db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE activo=0").get().n,
        },
        dispositivos: {
            total:   db.prepare("SELECT COUNT(*) AS n FROM dispositivos WHERE activo=1").get().n,
            online:  db.prepare("SELECT COUNT(*) AS n FROM dispositivos WHERE activo=1 AND online=1").get().n,
            offline: db.prepare("SELECT COUNT(*) AS n FROM dispositivos WHERE activo=1 AND online=0").get().n,
        },
        practicas:  db.prepare("SELECT COUNT(*) AS n FROM practicas WHERE activo=1").get().n,
        materias:   db.prepare("SELECT COUNT(*) AS n FROM materias WHERE activo=1").get().n,
        logs: {
            total:    db.prepare("SELECT COUNT(*) AS n FROM logs").get().n,
            hoy:      db.prepare("SELECT COUNT(*) AS n FROM logs WHERE fecha >= date('now')").get().n,
            semana:   db.prepare("SELECT COUNT(*) AS n FROM logs WHERE fecha >= date('now','-7 days')").get().n,
            mes:      db.prepare("SELECT COUNT(*) AS n FROM logs WHERE fecha >= date('now','-30 days')").get().n,
        },
        accesos_por_dia: db.prepare(`
            SELECT date(fecha) AS dia, COUNT(*) AS total
            FROM logs WHERE accion='acceso_practica'
            AND fecha >= date('now','-30 days')
            GROUP BY dia ORDER BY dia DESC LIMIT 14
        `).all(),
        practicas_mas_usadas: db.prepare(`
            SELECT p.titulo, COUNT(l.id) AS usos
            FROM logs l JOIN practicas p ON l.practica_id = p.id
            WHERE l.accion='acceso_practica'
            GROUP BY p.id ORDER BY usos DESC LIMIT 5
        `).all(),
        db_size_kb: (() => {
            try { return Math.round(fs.statSync('/app/data/laboratorio.db').size / 1024); } catch { return 0; }
        })()
    };
    res.json(stats);
});

// ── GET /api/sa/config — obtener configuración ────────────────────
router.get('/config', verificarToken, soloSuperAdmin, (req, res) => {
    const rows = db.prepare('SELECT clave, valor FROM config').all();
    const config = {};
    rows.forEach(r => config[r.clave] = r.valor);
    res.json(config);
});

// ── PUT /api/sa/config — guardar configuración ────────────────────
router.put('/config', verificarToken, soloSuperAdmin, (req, res) => {
    const entries = Object.entries(req.body);
    const upsert = db.prepare('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)');
    const many = db.transaction(() => entries.forEach(([k, v]) => upsert.run(k, v)));
    many();
    db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'config_update', ?)")
      .run(req.usuario.id, `Actualizó ${entries.length} parámetros`);
    res.json({ mensaje: 'Configuración guardada' });
});

// ── DELETE /api/sa/logs — limpiar logs ────────────────────────────
router.delete('/logs', verificarToken, soloSuperAdmin, (req, res) => {
    const { dias } = req.query;
    let eliminados;
    if (dias) {
        eliminados = db.prepare(`DELETE FROM logs WHERE fecha < date('now','-${parseInt(dias)} days')`).run().changes;
    } else {
        eliminados = db.prepare('DELETE FROM logs').run().changes;
    }
    db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'limpiar_logs', ?)")
      .run(req.usuario.id, `Eliminó ${eliminados} registros de logs`);
    res.json({ mensaje: `${eliminados} registros eliminados` });
});

// ── DELETE /api/sa/vaciar/:tabla — vaciar tabla ───────────────────
router.delete('/vaciar/:tabla', verificarToken, soloSuperAdmin, (req, res) => {
    const tablasPermitidas = ['logs', 'dispositivos', 'practicas'];
    const { tabla } = req.params;
    if (!tablasPermitidas.includes(tabla))
        return res.status(400).json({ error: 'Tabla no permitida' });

    // Desactivar en lugar de borrar para preservar integridad
    if (tabla === 'logs') {
        const n = db.prepare('DELETE FROM logs').run().changes;
        db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'vaciar_tabla', ?)")
          .run(req.usuario.id, `Vació tabla: ${tabla} (${n} registros)`);
        return res.json({ mensaje: `Tabla ${tabla} vaciada (${n} registros)` });
    }
    let n;
    if (tabla === 'dispositivos') {
        // Renombrar IP y MAC con timestamp antes de desactivar
        // para liberar los índices UNIQUE y permitir reusos futuros
        const ts = Date.now();
        const disps = db.prepare('SELECT id, ip, mac FROM dispositivos WHERE activo = 1').all();
        const stmt = db.prepare('UPDATE dispositivos SET activo = 0, online = 0, ip = ?, mac = ? WHERE id = ?');
        const vaciar = db.transaction(() => {
            for (const d of disps) {
                const ipLib  = d.ip  ? `_eliminado_${ts}_${d.ip}`  : null;
                const macLib = d.mac ? `_eliminado_${ts}_${d.mac}` : null;
                stmt.run(ipLib, macLib, d.id);
            }
        });
        vaciar();
        n = disps.length;
    } else {
        n = db.prepare(`UPDATE ${tabla} SET activo = 0`).run().changes;
    }
    db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'vaciar_tabla', ?)")
      .run(req.usuario.id, `Desactivó ${n} registros en: ${tabla}`);
    res.json({ mensaje: `${n} registros desactivados en ${tabla}` });
});

// ── DELETE /api/sa/purgar/dispositivos — eliminar registros inactivos ─
router.delete('/purgar/dispositivos', verificarToken, soloSuperAdmin, (req, res) => {
    const purgar = db.transaction(() => {
        const inactivos = db.prepare('SELECT id FROM dispositivos WHERE activo = 0').all();
        if (!inactivos.length) return 0;
        for (const d of inactivos) {
            db.prepare('UPDATE logs SET dispositivo_id = NULL WHERE dispositivo_id = ?').run(d.id);
            db.prepare('DELETE FROM practicas WHERE dispositivo_id = ? AND activo = 0').run(d.id);
        }
        return db.prepare('DELETE FROM dispositivos WHERE activo = 0').run().changes;
    });
    const n = purgar();
    if (n > 0) {
        db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'purgar_dispositivos', ?)")
          .run(req.usuario.id, `Purgó ${n} dispositivo${n>1?'s':''} dados de baja`);
    }
    res.json({
        mensaje: n > 0
            ? `${n} dispositivo${n>1?'s':''} eliminado${n>1?'s':''} definitivamente`
            : 'No había dispositivos dados de baja para purgar.',
        n
    });
});

// ── GET /api/sa/backup — descargar backup de la BD ───────────────
router.get('/backup', verificarToken, soloSuperAdmin, (req, res) => {
    const src = '/app/data/laboratorio.db';
    const bkp = `/app/data/backup_${new Date().toISOString().slice(0,10)}.db`;
    try {
        fs.copyFileSync(src, bkp);
        db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'backup', ?)")
          .run(req.usuario.id, `Backup generado: ${path.basename(bkp)}`);
        res.download(bkp, path.basename(bkp), () => {
            try { fs.unlinkSync(bkp); } catch {}
        });
    } catch(e) {
        res.status(500).json({ error: 'Error al generar backup: ' + e.message });
    }
});

// ── GET /api/sa/tecnicos — gestionar técnicos ─────────────────────
router.get('/tecnicos', verificarToken, soloSuperAdmin, (req, res) => {
    const tecnicos = db.prepare(`
        SELECT id, nombre, email, rol, activo, creado_en, ultimo_acceso
        FROM usuarios WHERE rol IN ('tecnico','superadmin') ORDER BY rol, nombre
    `).all();
    res.json(tecnicos);
});

// ── POST /api/sa/tecnicos — crear técnico ─────────────────────────
router.post('/tecnicos', verificarToken, soloSuperAdmin, (req, res) => {
    const bcrypt = require('bcryptjs');
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password)
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
    if (!['tecnico','superadmin'].includes(rol))
        return res.status(400).json({ error: 'Rol inválido' });
    try {
        const r = db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?,?,?,?)')
                    .run(nombre, email, bcrypt.hashSync(password, 10), rol);
        db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'crear_tecnico', ?)")
          .run(req.usuario.id, `Creó ${rol}: ${nombre}`);
        res.status(201).json({ id: r.lastInsertRowid, mensaje: 'Usuario creado' });
    } catch(e) {
        if (e.message.includes('UNIQUE'))
            return res.status(409).json({ error: 'Email ya existe' });
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

// ── PUT /api/sa/tecnicos/:id — actualizar técnico ─────────────────
router.put('/tecnicos/:id', verificarToken, soloSuperAdmin, (req, res) => {
    const bcrypt = require('bcryptjs');
    const { nombre, email, password, activo } = req.body;
    const hash = password ? bcrypt.hashSync(password, 10) : null;
    db.prepare(`UPDATE usuarios SET
        nombre   = COALESCE(?, nombre),
        email    = COALESCE(?, email),
        password = COALESCE(?, password),
        activo   = COALESCE(?, activo)
        WHERE id = ?`).run(nombre, email, hash, activo, req.params.id);
    res.json({ mensaje: 'Actualizado' });
});

// ══════════════════════════════════════════════════════════════════
// DIAGNÓSTICO DEL SISTEMA
// ══════════════════════════════════════════════════════════════════

// ── GET /api/sa/diagnostico/estado — estado general del servidor ──
router.get('/diagnostico/estado', verificarToken, soloSuperAdmin, (req, res) => {
    const uptimeSeg = Math.floor(process.uptime());
    const horas     = Math.floor(uptimeSeg / 3600);
    const minutos   = Math.floor((uptimeSeg % 3600) / 60);
    const segundos  = uptimeSeg % 60;

    const mem  = process.memoryUsage();
    const disps = db.prepare('SELECT id, nombre, ip, online, activo, ultimo_ping FROM dispositivos WHERE activo = 1').all();

    res.json({
        servidor: {
            uptime_seg:  uptimeSeg,
            uptime_txt:  `${horas}h ${minutos}m ${segundos}s`,
            memoria_mb:  Math.round(mem.rss / 1024 / 1024),
            node_version: process.version,
            timestamp:   new Date().toISOString(),
        },
        dispositivos: disps,
        db_size_kb: (() => {
            try { return Math.round(fs.statSync('/app/data/laboratorio.db').size / 1024); } catch { return 0; }
        })()
    });
});

// ── POST /api/sa/diagnostico/ping-todos — forzar ping a todos ────
router.post('/diagnostico/ping-todos', verificarToken, soloSuperAdmin, async (req, res) => {
    const disps   = db.prepare('SELECT id, nombre, ip FROM dispositivos WHERE activo = 1').all();
    const resultados = [];

    for (const d of disps) {
        const inicio = Date.now();
        try {
            const r = await httpGet(d.ip, 5000);
            const ms = Date.now() - inicio;
            db.prepare('UPDATE dispositivos SET online = 1, ultimo_ping = ? WHERE id = ?')
              .run(new Date().toISOString(), d.id);
            resultados.push({ id: d.id, nombre: d.nombre, ip: d.ip, online: true, ms, status: r.status });
        } catch(e) {
            const ms = Date.now() - inicio;
            db.prepare('UPDATE dispositivos SET online = 0 WHERE id = ?').run(d.id);
            resultados.push({ id: d.id, nombre: d.nombre, ip: d.ip, online: false, ms, error: e.message });
        }
    }

    db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'ping_manual', ?)")
      .run(req.usuario.id, `Ping forzado a ${disps.length} dispositivos`);

    res.json({ resultados });
});

// ── POST /api/sa/diagnostico/ping/:id — ping a dispositivo específico
router.post('/diagnostico/ping/:id', verificarToken, soloSuperAdmin, async (req, res) => {
    const d = db.prepare('SELECT * FROM dispositivos WHERE id = ? AND activo = 1').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    const inicio = Date.now();
    try {
        const r  = await httpGet(d.ip, 5000);
        const ms = Date.now() - inicio;
        db.prepare('UPDATE dispositivos SET online = 1, ultimo_ping = ? WHERE id = ?')
          .run(new Date().toISOString(), d.id);
        res.json({ online: true, ms, status: r.status, ip: d.ip });
    } catch(e) {
        const ms = Date.now() - inicio;
        db.prepare('UPDATE dispositivos SET online = 0 WHERE id = ?').run(d.id);
        res.json({ online: false, ms, error: e.message, ip: d.ip });
    }
});

// ── PUT /api/sa/diagnostico/online/:id — forzar estado manualmente
router.put('/diagnostico/online/:id', verificarToken, soloSuperAdmin, (req, res) => {
    const { online } = req.body;
    const d = db.prepare('SELECT nombre FROM dispositivos WHERE id = ? AND activo = 1').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'No encontrado' });
    db.prepare('UPDATE dispositivos SET online = ? WHERE id = ?').run(online ? 1 : 0, req.params.id);
    db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'forzar_estado', ?)")
      .run(req.usuario.id, `Forzó ${d.nombre} a ${online ? 'ONLINE' : 'OFFLINE'}`);
    res.json({ mensaje: `Dispositivo marcado como ${online ? 'online' : 'offline'}` });
});

// ── PUT /api/sa/diagnostico/ip/:id — editar IP sin eliminar ───────
router.put('/diagnostico/ip/:id', verificarToken, soloSuperAdmin, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP requerida' });
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) return res.status(400).json({ error: 'Formato de IP inválido' });

    const d = db.prepare('SELECT nombre FROM dispositivos WHERE id = ? AND activo = 1').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'No encontrado' });

    try {
        db.prepare('UPDATE dispositivos SET ip = ?, online = 0 WHERE id = ?').run(ip, req.params.id);
        db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'cambio_ip', ?)")
          .run(req.usuario.id, `Cambió IP de ${d.nombre} a ${ip}`);
        res.json({ mensaje: 'IP actualizada' });
    } catch(e) {
        if (e.message.includes('UNIQUE'))
            return res.status(409).json({ error: 'Ya existe un dispositivo con esa IP' });
        res.status(500).json({ error: 'Error al actualizar IP' });
    }
});

router.get('/diagnostico/test-esp32/:id', verificarToken, soloSuperAdmin, async (req, res) => {
    const d = db.prepare('SELECT * FROM dispositivos WHERE id = ? AND activo = 1').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'No encontrado' });

    const pasos = [];

    try {
        const t0 = Date.now();
        const r  = await httpGet(d.ip, 5000);
        pasos.push({ paso: 'Conexión HTTP', ok: true, detalle: `HTTP ${r.status} en ${Date.now()-t0}ms` });

        const esHTML = r.body.trim().startsWith('<') || r.body.toLowerCase().includes('<html');
        pasos.push({ paso: 'Respuesta HTML', ok: esHTML, detalle: esHTML ? `${r.body.length} bytes recibidos` : 'La respuesta no parece HTML' });

        const recursos   = (r.body.match(/src=["']([^"']+)["']|href=["']([^"']+\.css[^"']*)["']/g) || []);
        const recursosRel = recursos.filter(x => !x.includes('http'));
        pasos.push({ paso: 'Recursos detectados', ok: true, detalle: `${recursos.length} recursos (${recursosRel.length} relativos — resueltos vía base tag)` });

        db.prepare('UPDATE dispositivos SET online = 1, ultimo_ping = ? WHERE id = ?')
          .run(new Date().toISOString(), d.id);
    } catch(e) {
        pasos.push({ paso: 'Conexión HTTP', ok: false, detalle: `Error: ${e.message}` });
        db.prepare('UPDATE dispositivos SET online = 0 WHERE id = ?').run(d.id);
    }

    res.json({ dispositivo: { nombre: d.nombre, ip: d.ip }, pasos });
});


// ── POST /api/sa/diagnostico/escanear-red ─────────────────────────
// Barre un rango de IPs en paralelo (lotes de 20), hace GET /ping
// a cada una y clasifica las respuestas según tres firmas conocidas:
//
//   Firma A — RC-LAB v2.0.7+  (mini_web.h actualizado)
//     {"ok":true,"mac":"XX:XX:XX:XX:XX:XX","version":"2.0.7","ensayo_id":"rc_lab"}
//     → MAC disponible directamente desde el escaneo
//
//   Firma B — Firmware legacy con JSON (EnsayoCaldera v2.5, etc.)
//     {"ok":true, ...}  sin campo "mac"
//     → Sin MAC; el técnico debe ingresarla al dar de alta
//
//   Firma C — RC-LAB anterior a v2.0.7
//     "PONG"  (texto plano)
//     → Sin MAC; el técnico debe ingresarla al dar de alta
//
// El campo "sin_mac" en cada resultado indica si hay que pedirla
// manualmente. El campo "firmware" permite mostrar un aviso apropiado
// en el panel técnico según la versión detectada.
router.post('/diagnostico/escanear-red', verificarToken, soloSuperAdmin, async (req, res) => {
    let { base, desde, hasta } = req.body;

    // Valores por defecto: 192.168.1.1 – 192.168.1.254
    base  = (base  || '192.168.1').trim();
    desde = parseInt(desde) || 1;
    hasta = parseInt(hasta) || 254;

    if (desde < 1 || hasta > 254 || desde > hasta)
        return res.status(400).json({ error: 'Rango inválido. desde/hasta deben estar entre 1 y 254.' });

    // IPs ya registradas en BD (activas)
    const registrados    = db.prepare('SELECT id, nombre, ip, mac FROM dispositivos WHERE activo = 1').all();
    const ipsRegistradas = new Set(registrados.map(d => d.ip));

    const encontrados = [];
    const LOTE    = 20;
    const TIMEOUT = 1500;

    const ips = [];
    for (let i = desde; i <= hasta; i++) ips.push(`${base}.${i}`);

    // Detectar si una respuesta corresponde a un ESP32 del Lab System
    // y extraer los metadatos disponibles según la firma del firmware.
    // Devuelve null si la IP no es un ESP32 reconocido.
    function parsearRespuestaESP32(ip, body) {
        const texto = body.trim();

        // ── Firma A: RC-LAB v2.0.7+ — JSON con MAC ──────────────
        if (texto.startsWith('{')) {
            try {
                const json = JSON.parse(texto);
                if (json.ok === true && json.mac) {
                    return {
                        ip,
                        mac:       json.mac,
                        ensayo_id: json.ensayo_id  || null,
                        version:   json.version    || null,
                        firmware:  'rc-lab-v2',
                        sin_mac:   false,
                    };
                }
                // ── Firma B: JSON sin MAC (legacy) ───────────────
                if (json.ok === true) {
                    return {
                        ip,
                        mac:       null,
                        ensayo_id: json.ensayo_id  || null,
                        version:   json.version    || null,
                        firmware:  'legacy-json',
                        sin_mac:   true,
                    };
                }
            } catch (_) { /* no era JSON válido */ }
        }

        // ── Firma C: PONG — RC-LAB anterior a v2.0.7 ────────────
        if (texto === 'PONG') {
            return {
                ip,
                mac:       null,
                ensayo_id: null,
                version:   null,
                firmware:  'legacy-pong',
                sin_mac:   true,
            };
        }

        return null; // no es un ESP32 reconocido
    }

    // Procesar en lotes
    for (let i = 0; i < ips.length; i += LOTE) {
        const lote = ips.slice(i, i + LOTE);
        const resultados = await Promise.allSettled(
            lote.map(ip =>
                new Promise((resolve, reject) => {
                    const reqHttp = http.get(`http://${ip}/ping`, { timeout: TIMEOUT }, (res) => {
                        let body = '';
                        res.on('data', c => body += c);
                        res.on('end', () => resolve({ ip, status: res.statusCode, body: body.trim() }));
                    });
                    reqHttp.on('timeout', () => { reqHttp.destroy(); reject(new Error('timeout')); });
                    reqHttp.on('error',   (e) => reject(e));
                })
            )
        );

        for (const r of resultados) {
            if (r.status !== 'fulfilled') continue;

            const esp32 = parsearRespuestaESP32(r.value.ip, r.value.body);
            if (!esp32) continue;

            const yaRegistrado = registrados.find(d => d.ip === esp32.ip);
            encontrados.push({
                ip:        esp32.ip,
                mac:       esp32.mac,           // null si firmware legacy
                ensayo_id: esp32.ensayo_id,
                version:   esp32.version,
                firmware:  esp32.firmware,
                sin_mac:   esp32.sin_mac,       // true → pedir MAC al dar de alta
                registrado: !!yaRegistrado,
                nombre:    yaRegistrado?.nombre || null,
                id:        yaRegistrado?.id     || null,
            });
        }
    }

    const nuevos    = encontrados.filter(e => !e.registrado);
    const conocidos = encontrados.filter(e =>  e.registrado);

    db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'escaneo_red', ?)")
      .run(req.usuario.id, `Escaneó ${ips.length} IPs (${base}.${desde}–${hasta}): ${encontrados.length} ESP32 encontrados, ${nuevos.length} nuevos`);

    res.json({
        rango:     `${base}.${desde} – ${base}.${hasta}`,
        total_ips: ips.length,
        encontrados: encontrados.length,
        nuevos,
        conocidos,
    });
});

// ── POST /api/sa/consola — ejecutar comando predefinido ───────────
// Lista blanca estricta: solo comandos específicos del Lab System.
// Cada entrada tiene: id, label, comando real a ejecutar.
const COMANDOS_CONSOLA = [
    // Docker
    { id: 'docker_ps',        grupo: 'Docker',       label: 'Estado contenedores',         cmd: 'docker compose -f /home/udemm/lab-system/docker-compose.yml ps' },
    { id: 'docker_logs_back', grupo: 'Docker',       label: 'Logs backend (últimas 50)',    cmd: 'docker compose -f /home/udemm/lab-system/docker-compose.yml logs backend --tail=50 --no-color' },
    { id: 'docker_logs_nginx',grupo: 'Docker',       label: 'Logs Nginx (últimas 20)',      cmd: 'docker compose -f /home/udemm/lab-system/docker-compose.yml logs nginx --tail=20 --no-color' },
    { id: 'docker_restart',   grupo: 'Docker',       label: 'Reiniciar backend',            cmd: 'docker compose -f /home/udemm/lab-system/docker-compose.yml restart backend' },
    // Base de datos
    { id: 'db_dispositivos',  grupo: 'Base de datos',label: 'Ver todos los dispositivos',   cmd: `docker exec lab_backend node -e "const db=require('./database');console.log(JSON.stringify(db.prepare('SELECT id,nombre,ip,mac,activo,online FROM dispositivos').all(),null,2))"` },
    { id: 'db_macs_pend',     grupo: 'Base de datos',label: 'MACs pendientes de alta',      cmd: `docker exec lab_backend node -e "const db=require('./database');console.log(JSON.stringify(db.prepare(\"SELECT accion,detalle,fecha FROM logs WHERE accion='registro_mac_desconocida' ORDER BY fecha DESC LIMIT 10\").all(),null,2))"` },
    { id: 'db_logs_rec',      grupo: 'Base de datos',label: 'Últimos 20 logs',              cmd: `docker exec lab_backend node -e "const db=require('./database');console.log(JSON.stringify(db.prepare('SELECT id,accion,detalle,fecha FROM logs ORDER BY fecha DESC LIMIT 20').all(),null,2))"` },
    { id: 'db_migration',     grupo: 'Base de datos',label: 'Aplicar migración MAC',        cmd: `docker exec lab_backend node -e "const db=require('./database');try{db.exec('ALTER TABLE dispositivos ADD COLUMN mac TEXT');db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_dispositivos_mac ON dispositivos(mac)');console.log('Migración aplicada');}catch(e){console.log(e.message);}"` },
    // Sistema
    { id: 'sys_df',           grupo: 'Sistema',      label: 'Uso de disco',                 cmd: 'df -h' },
    { id: 'sys_uptime',       grupo: 'Sistema',      label: 'Uptime del sistema',           cmd: 'uptime' },
    { id: 'sys_temp',         grupo: 'Sistema',      label: 'Temperatura CPU',              cmd: 'vcgencmd measure_temp' },
    { id: 'sys_mem',          grupo: 'Sistema',      label: 'Uso de memoria',               cmd: 'free -h' },
    // Red
    { id: 'net_ip',           grupo: 'Red',          label: 'Interfaces de red',            cmd: 'ip a' },
    { id: 'net_wifi',         grupo: 'Red',          label: 'Red WiFi activa',              cmd: 'iwgetid' },
];

router.post('/consola/libre', verificarToken, soloSuperAdmin, (req, res) => {
    const { cmd } = req.body;
    if (!cmd || !cmd.trim()) {
        return res.status(400).json({ error: 'Comando vacío' });
    }

    const { exec } = require('child_process');

    db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'consola_libre', ?)")
      .run(req.usuario.id, `CMD: ${cmd.trim().substring(0, 200)}`);

    exec(cmd.trim(), { timeout: 30000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
        res.json({
            ok:     !err,
            output: (stdout || '') + (stderr || ''),
            error:  err ? err.message : null,
        });
    });
});

router.get('/consola/comandos', verificarToken, soloSuperAdmin, (req, res) => {
    // Devuelve la lista de comandos disponibles (sin el cmd real por seguridad)
    res.json(COMANDOS_CONSOLA.map(({ id, grupo, label }) => ({ id, grupo, label })));
});

router.post('/consola', verificarToken, soloSuperAdmin, (req, res) => {
    const { comando_id } = req.body;
    const entrada = COMANDOS_CONSOLA.find(c => c.id === comando_id);

    if (!entrada) {
        return res.status(400).json({ error: 'Comando no permitido' });
    }

    const { exec } = require('child_process');

    db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'consola_cmd', ?)")
      .run(req.usuario.id, `Ejecutó: ${entrada.label}`);

    exec(entrada.cmd, { timeout: 15000, maxBuffer: 1024 * 256 }, (err, stdout, stderr) => {
        res.json({
            ok:     !err,
            label:  entrada.label,
            output: (stdout || '') + (stderr || ''),
            error:  err ? err.message : null,
        });
    });
});

module.exports = router;
