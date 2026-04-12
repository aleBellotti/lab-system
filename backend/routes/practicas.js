const express = require('express');
const db = require('../database');
const { verificarToken, soloTecnico } = require('./auth');

const router = express.Router();

// GET /api/practicas — listar (profesor ve solo las suyas)
router.get('/', verificarToken, (req, res) => {
    let practicas;

    if (['tecnico', 'superadmin'].includes(req.usuario.rol)) {
        practicas = db.prepare(`
            SELECT p.*, m.nombre AS materia_nombre, d.nombre AS dispositivo_nombre, d.ip, d.online
            FROM practicas p
            LEFT JOIN materias m ON p.materia_id = m.id
            LEFT JOIN dispositivos d ON p.dispositivo_id = d.id
            WHERE p.activo = 1
            ORDER BY m.nombre, p.titulo
        `).all();
    } else {
        // El profesor solo ve prácticas de sus materias asignadas
        practicas = db.prepare(`
            SELECT p.*, m.nombre AS materia_nombre, d.nombre AS dispositivo_nombre, d.ip, d.online
            FROM practicas p
            LEFT JOIN materias m ON p.materia_id = m.id
            LEFT JOIN dispositivos d ON p.dispositivo_id = d.id
            INNER JOIN usuario_materia um ON um.materia_id = p.materia_id
            WHERE p.activo = 1
              AND um.usuario_id = ?
            ORDER BY m.nombre, p.titulo
        `).all(req.usuario.id);
    }

    res.json(practicas);
});

// GET /api/practicas/:id — detalle
router.get('/:id', verificarToken, (req, res) => {
    const practica = db.prepare(`
        SELECT p.*, m.nombre AS materia_nombre, d.nombre AS dispositivo_nombre, d.ip, d.online, d.activo AS dispositivo_activo
        FROM practicas p
        LEFT JOIN materias m ON p.materia_id = m.id
        LEFT JOIN dispositivos d ON p.dispositivo_id = d.id
        WHERE p.id = ? AND p.activo = 1
    `).get(req.params.id);

    if (!practica) return res.status(404).json({ error: 'Práctica no encontrada' });

    // Registrar acceso en log
    db.prepare(`
        INSERT INTO logs (usuario_id, practica_id, dispositivo_id, accion, detalle)
        VALUES (?, ?, ?, 'acceso_practica', ?)
    `).run(req.usuario.id, practica.id, practica.dispositivo_id, practica.titulo);

    res.json(practica);
});

// POST /api/practicas — crear (solo técnico)
router.post('/', verificarToken, soloTecnico, (req, res) => {
    const { titulo, descripcion, materia_id, dispositivo_id } = req.body;

    if (!titulo || !materia_id || !dispositivo_id) {
        return res.status(400).json({ error: 'Título, materia y dispositivo son requeridos' });
    }

    const result = db.prepare(`
        INSERT INTO practicas (titulo, descripcion, materia_id, dispositivo_id)
        VALUES (?, ?, ?, ?)
    `).run(titulo, descripcion || null, materia_id, dispositivo_id);

    res.status(201).json({ id: result.lastInsertRowid, mensaje: 'Práctica creada' });
});

// PUT /api/practicas/:id — actualizar (solo técnico)
router.put('/:id', verificarToken, soloTecnico, (req, res) => {
    const { titulo, descripcion, materia_id, dispositivo_id, activo } = req.body;

    db.prepare(`
        UPDATE practicas
        SET titulo = COALESCE(?, titulo),
            descripcion = COALESCE(?, descripcion),
            materia_id = COALESCE(?, materia_id),
            dispositivo_id = COALESCE(?, dispositivo_id),
            activo = COALESCE(?, activo)
        WHERE id = ?
    `).run(titulo, descripcion, materia_id, dispositivo_id, activo, req.params.id);

    res.json({ mensaje: 'Práctica actualizada' });
});

// DELETE /api/practicas/:id — desactivar (solo técnico)
router.delete('/:id', verificarToken, soloTecnico, (req, res) => {
    db.prepare('UPDATE practicas SET activo = 0 WHERE id = ?').run(req.params.id);
    res.json({ mensaje: 'Práctica desactivada' });
});

module.exports = router;
