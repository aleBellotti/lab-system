const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { verificarToken, soloTecnico } = require('./auth');

const router = express.Router();

// GET /api/usuarios — listar (solo técnico)
router.get('/', verificarToken, soloTecnico, (req, res) => {
    const usuarios = db.prepare(`
        SELECT id, nombre, email, rol, activo, creado_en
        FROM usuarios WHERE activo = 1 ORDER BY rol, nombre
    `).all();
    res.json(usuarios);
});

// GET /api/usuarios/:id/materias — materias asignadas
router.get('/:id/materias', verificarToken, soloTecnico, (req, res) => {
    const materias = db.prepare(`
        SELECT m.* FROM materias m
        INNER JOIN usuario_materia um ON um.materia_id = m.id
        WHERE um.usuario_id = ?
    `).all(req.params.id);
    res.json(materias);
});

// POST /api/usuarios — crear usuario (solo técnico)
router.post('/', verificarToken, soloTecnico, (req, res) => {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password || !rol)
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
    if (!['tecnico', 'profesor'].includes(rol))
        return res.status(400).json({ error: 'Rol inválido' });
    try {
        const hash = bcrypt.hashSync(password, 10);

        const existente = db.prepare('SELECT id, activo FROM usuarios WHERE email = ?').get(email);
        if (existente) {
            if (existente.activo === 1)
                return res.status(409).json({ error: 'Ya existe un usuario activo con ese email' });
            // El email pertenece a un usuario dado de baja: reactivarlo con los nuevos datos
            db.prepare('UPDATE usuarios SET nombre = ?, password = ?, rol = ?, activo = 1 WHERE id = ?')
              .run(nombre, hash, rol, existente.id);
            return res.status(200).json({ id: existente.id, mensaje: 'Usuario reactivado' });
        }

        const result = db.prepare(
            'INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)'
        ).run(nombre, email, hash, rol);
        res.status(201).json({ id: result.lastInsertRowid, mensaje: 'Usuario creado' });
    } catch (e) {
        if (e.message.includes('UNIQUE'))
            return res.status(409).json({ error: 'Ya existe un usuario activo con ese email' });
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

// POST /api/usuarios/:id/materias — asignar materia
router.post('/:id/materias', verificarToken, soloTecnico, (req, res) => {
    const { materia_id } = req.body;
    try {
        db.prepare('INSERT OR IGNORE INTO usuario_materia (usuario_id, materia_id) VALUES (?, ?)')
          .run(req.params.id, materia_id);
        res.json({ mensaje: 'Materia asignada' });
    } catch {
        res.status(500).json({ error: 'Error al asignar materia' });
    }
});

// DELETE /api/usuarios/:id/materias/:materia_id — quitar materia
router.delete('/:id/materias/:materia_id', verificarToken, soloTecnico, (req, res) => {
    db.prepare('DELETE FROM usuario_materia WHERE usuario_id = ? AND materia_id = ?')
      .run(req.params.id, req.params.materia_id);
    res.json({ mensaje: 'Materia removida' });
});

// DELETE /api/usuarios/:id — eliminar usuario (borrado lógico, solo técnico)
router.delete('/:id', verificarToken, soloTecnico, (req, res) => {
    const id = req.params.id;

    // No permitir que un técnico se elimine a sí mismo
    if (parseInt(id) === req.usuario.id)
        return res.status(400).json({ error: 'No podés eliminar tu propia cuenta' });

    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!usuario)
        return res.status(404).json({ error: 'Usuario no encontrado' });

    // Borrado lógico: activo = 0 (preserva logs e historial)
    db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(id);

    db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'eliminar_usuario', ?)")
        .run(req.usuario.id, `Usuario eliminado: ${usuario.nombre} (${usuario.email})`);

    res.json({ mensaje: 'Usuario eliminado' });
});

// PUT /api/usuarios/:id — actualizar usuario (solo técnico)
router.put('/:id', verificarToken, soloTecnico, (req, res) => {
    const { nombre, email, password, rol, activo } = req.body;
    if (rol && !['tecnico', 'profesor'].includes(rol))
        return res.status(400).json({ error: 'Rol inválido' });
    const hash = password ? bcrypt.hashSync(password, 10) : null;
    db.prepare(`
        UPDATE usuarios
        SET nombre   = COALESCE(?, nombre),
            email    = COALESCE(?, email),
            password = COALESCE(?, password),
            rol      = COALESCE(?, rol),
            activo   = COALESCE(?, activo)
        WHERE id = ?
    `).run(nombre, email, hash, rol, activo, req.params.id);
    res.json({ mensaje: 'Usuario actualizado' });
});

// PUT /api/usuarios/mi-cuenta/password — cambio de contraseña propio
router.put('/mi-cuenta/password', verificarToken, (req, res) => {
    const { password_actual, password_nuevo } = req.body;
    if (!password_actual || !password_nuevo)
        return res.status(400).json({ error: 'Ambas contraseñas son requeridas' });
    if (password_nuevo.length < 6)
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
    if (!bcrypt.compareSync(password_actual, usuario.password))
        return res.status(401).json({ error: 'La contraseña actual es incorrecta' });

    const hash = bcrypt.hashSync(password_nuevo, 10);
    db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(hash, req.usuario.id);

    db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'cambio_password', ?)")
      .run(req.usuario.id, 'Cambio de contraseña exitoso');

    res.json({ mensaje: 'Contraseña actualizada correctamente' });
});

// GET /api/usuarios/logs/recientes — últimos accesos (solo técnico)
router.get('/logs/recientes', verificarToken, soloTecnico, (req, res) => {
    const logs = db.prepare(`
        SELECT l.*, u.nombre AS usuario_nombre, u.rol,
               p.titulo AS practica_titulo
        FROM logs l
        LEFT JOIN usuarios u ON l.usuario_id = u.id
        LEFT JOIN practicas p ON l.practica_id = p.id
        ORDER BY l.fecha DESC LIMIT 50
    `).all();
    res.json(logs);
});

module.exports = router;
