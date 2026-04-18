const express = require('express');
const db = require('../database');
const { verificarToken, soloTecnico } = require('./auth');

const router = express.Router();

// ══════════════════════════════════════════════════════════════════
// POST /api/dispositivos/registro — SIN autenticación
// Llamado por el ESP32 al arrancar. Envía su MAC e IP actual.
// El backend identifica el dispositivo por MAC y actualiza la IP.
// ══════════════════════════════════════════════════════════════════
router.post('/registro', (req, res) => {
    const { mac, ip, ensayo_id } = req.body;

    if (!mac || !ip) {
        return res.status(400).json({ error: 'mac e ip requeridos' });
    }

    // Validar formato MAC: AA:BB:CC:DD:EE:FF
    if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac)) {
        return res.status(400).json({ error: 'Formato de MAC inválido' });
    }

    const dispositivo = db.prepare(`
        SELECT id, nombre, ip
        FROM   dispositivos
        WHERE  mac = ? AND activo = 1
    `).get(mac.toUpperCase());

    if (!dispositivo) {
        // MAC desconocida — loguear para que el técnico la dé de alta
        const detalle = `MAC desconocida: ${mac} | IP: ${ip}${ensayo_id ? ' | ensayo: ' + ensayo_id : ''}`;
        console.log(`⚠️  [REGISTRO] ${detalle}`);
        db.prepare("INSERT INTO logs (accion, detalle) VALUES ('registro_mac_desconocida', ?)").run(detalle);
        return res.status(404).json({ error: 'dispositivo no registrado', mac });
    }

    const ipAnterior = dispositivo.ip;

    db.prepare(`
        UPDATE dispositivos
        SET ip = ?, online = 1, ultimo_ping = datetime('now')
        WHERE id = ?
    `).run(ip, dispositivo.id);

    const detalle = ipAnterior !== ip
        ? `IP actualizada: ${ipAnterior ?? 'sin asignar'} → ${ip} (${dispositivo.nombre})`
        : `Online: ${dispositivo.nombre} (${ip})`;

    console.log(`✅ [REGISTRO] ${detalle}`);
    db.prepare("INSERT INTO logs (dispositivo_id, accion, detalle) VALUES (?, 'registro_esp32', ?)")
      .run(dispositivo.id, detalle);

    res.json({ ok: true, nombre: dispositivo.nombre, ip });
});

// ── GET /api/dispositivos — listar todos ─────────────────────────
router.get('/', verificarToken, (req, res) => {
    const dispositivos = db.prepare(`
        SELECT d.*, m.nombre AS materia_nombre
        FROM dispositivos d
        LEFT JOIN materias m ON d.materia_id = m.id
        WHERE d.activo = 1
        ORDER BY d.nombre
    `).all();
    res.json(dispositivos);
});

// ── GET /api/dispositivos/:id — detalle ──────────────────────────
router.get('/:id', verificarToken, (req, res) => {
    const dispositivo = db.prepare(`
        SELECT d.*, m.nombre AS materia_nombre
        FROM dispositivos d
        LEFT JOIN materias m ON d.materia_id = m.id
        WHERE d.id = ?
    `).get(req.params.id);

    if (!dispositivo) return res.status(404).json({ error: 'No encontrado' });
    res.json(dispositivo);
});

// ── POST /api/dispositivos — crear (solo técnico) ────────────────
router.post('/', verificarToken, soloTecnico, (req, res) => {
    const { nombre, ip, mac, descripcion, materia_id } = req.body;

    if (!nombre) {
        return res.status(400).json({ error: 'El nombre es requerido' });
    }

    // IP es opcional al crear — el ESP32 la completa al registrarse
    if (ip) {
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(ip)) {
            return res.status(400).json({ error: 'Formato de IP inválido' });
        }
    }

    // MAC opcional pero con validación de formato si se provee
    const macNorm = mac ? mac.trim().toUpperCase() : null;
    if (macNorm && !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(macNorm)) {
        return res.status(400).json({ error: 'Formato de MAC inválido. Usar XX:XX:XX:XX:XX:XX' });
    }

    try {
        const result = db.prepare(`
            INSERT INTO dispositivos (nombre, ip, mac, descripcion, materia_id)
            VALUES (?, ?, ?, ?, ?)
        `).run(nombre, ip || null, macNorm, descripcion || null, materia_id || null);

        res.status(201).json({ id: result.lastInsertRowid, mensaje: 'Dispositivo creado' });
    } catch (e) {
        if (e.message.includes('UNIQUE')) {
            if (e.message.includes('ip'))  return res.status(409).json({ error: 'Ya existe un dispositivo con esa IP' });
            if (e.message.includes('mac')) return res.status(409).json({ error: 'Ya existe un dispositivo con esa MAC' });
        }
        res.status(500).json({ error: 'Error al crear dispositivo' });
    }
});

// ── PUT /api/dispositivos/:id — actualizar (solo técnico) ────────
router.put('/:id', verificarToken, soloTecnico, (req, res) => {
    const { nombre, ip, mac, descripcion, materia_id, activo } = req.body;

    const dispositivo = db.prepare('SELECT id FROM dispositivos WHERE id = ?').get(req.params.id);
    if (!dispositivo) return res.status(404).json({ error: 'No encontrado' });

    const macNorm = mac ? mac.trim().toUpperCase() : undefined;
    if (macNorm && !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(macNorm)) {
        return res.status(400).json({ error: 'Formato de MAC inválido. Usar XX:XX:XX:XX:XX:XX' });
    }

    try {
        db.prepare(`
            UPDATE dispositivos
            SET nombre      = COALESCE(?, nombre),
                ip          = COALESCE(?, ip),
                mac         = COALESCE(?, mac),
                descripcion = COALESCE(?, descripcion),
                materia_id  = COALESCE(?, materia_id),
                activo      = COALESCE(?, activo)
            WHERE id = ?
        `).run(nombre, ip, macNorm, descripcion, materia_id, activo, req.params.id);

        res.json({ mensaje: 'Dispositivo actualizado' });
    } catch (e) {
        if (e.message.includes('UNIQUE')) {
            if (e.message.includes('ip'))  return res.status(409).json({ error: 'Ya existe un dispositivo con esa IP' });
            if (e.message.includes('mac')) return res.status(409).json({ error: 'Ya existe un dispositivo con esa MAC' });
        }
        res.status(500).json({ error: 'Error al actualizar dispositivo' });
    }
});

// ── DELETE /api/dispositivos/:id — desactivar y liberar IP + MAC ─
router.delete('/:id', verificarToken, soloTecnico, (req, res) => {
    try {
        const disp = db.prepare('SELECT ip, mac FROM dispositivos WHERE id = ?').get(req.params.id);
        if (!disp) return res.status(404).json({ error: 'No encontrado' });

        const ts     = Date.now();
        const ipLib  = disp.ip  ? `_eliminado_${ts}_${disp.ip}`  : null;
        const macLib = disp.mac ? `_eliminado_${ts}_${disp.mac}` : null;

        db.prepare('UPDATE dispositivos SET activo = 0, online = 0, ip = ?, mac = ? WHERE id = ?')
          .run(ipLib, macLib, req.params.id);
        res.json({ mensaje: 'Dispositivo desactivado' });
    } catch(e) {
        res.status(500).json({ error: 'Error al desactivar dispositivo: ' + e.message });
    }
});

// ── GET /api/dispositivos/materias/lista — para dropdowns ────────
router.get('/materias/lista', verificarToken, (req, res) => {
    const materias = db.prepare('SELECT * FROM materias WHERE activo = 1 ORDER BY nombre').all();
    res.json(materias);
});

module.exports = router;
