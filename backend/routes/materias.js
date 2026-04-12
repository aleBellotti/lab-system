const express = require('express');
const db = require('../database');
const { verificarToken, soloTecnico } = require('./auth');

const router = express.Router();

// GET /api/materias — listar todas
router.get('/', verificarToken, (req, res) => {
    const materias = db.prepare(`
        SELECT m.*,
               COUNT(DISTINCT p.id) AS total_practicas,
               COUNT(DISTINCT um.usuario_id) AS total_profesores
        FROM materias m
        LEFT JOIN practicas p ON p.materia_id = m.id AND p.activo = 1
        LEFT JOIN usuario_materia um ON um.materia_id = m.id
        WHERE m.activo = 1
        GROUP BY m.id
        ORDER BY m.nombre
    `).all();
    res.json(materias);
});

// POST /api/materias — crear (solo técnico)
router.post('/', verificarToken, soloTecnico, (req, res) => {
    const { nombre, descripcion } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    try {
        const result = db.prepare(
            'INSERT INTO materias (nombre, descripcion) VALUES (?, ?)'
        ).run(nombre, descripcion || null);
        res.status(201).json({ id: result.lastInsertRowid, mensaje: 'Materia creada' });
    } catch (e) {
        res.status(500).json({ error: 'Error al crear materia' });
    }
});

// PUT /api/materias/:id — actualizar (solo técnico)
router.put('/:id', verificarToken, soloTecnico, (req, res) => {
    const { nombre, descripcion } = req.body;
    db.prepare(`
        UPDATE materias
        SET nombre      = COALESCE(?, nombre),
            descripcion = COALESCE(?, descripcion)
        WHERE id = ?
    `).run(nombre, descripcion, req.params.id);
    res.json({ mensaje: 'Materia actualizada' });
});

// DELETE /api/materias/:id — desactivar (solo técnico)
router.delete('/:id', verificarToken, soloTecnico, (req, res) => {
    db.prepare('UPDATE materias SET activo = 0 WHERE id = ?').run(req.params.id);
    res.json({ mensaje: 'Materia desactivada' });
});

module.exports = router;
