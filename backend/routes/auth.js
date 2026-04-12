const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../database');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'facultad_lab_secret_2024';

// ── Middlewares ───────────────────────────────────────────────────
function verificarToken(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth) return res.status(401).json({ error: 'Token requerido' });
    try {
        req.usuario = jwt.verify(auth.split(' ')[1], SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

function soloTecnico(req, res, next) {
    // técnico Y superadmin tienen acceso
    if (!['tecnico','superadmin'].includes(req.usuario.rol))
        return res.status(403).json({ error: 'Acceso no autorizado' });
    next();
}

function soloSuperAdmin(req, res, next) {
    if (req.usuario.rol !== 'superadmin')
        return res.status(403).json({ error: 'Requiere permisos de Super Administrador' });
    next();
}

// ── Login ─────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: 'Email y contraseña requeridos' });

    const u = db.prepare('SELECT * FROM usuarios WHERE email = ? AND activo = 1').get(email);
    if (!u || !bcrypt.compareSync(password, u.password))
        return res.status(401).json({ error: 'Credenciales incorrectas' });

    const token = jwt.sign(
        { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol },
        SECRET, { expiresIn: '8h' }
    );

    // Actualizar último acceso
    try { db.prepare('UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?').run(new Date().toISOString(), u.id); } catch {}

    db.prepare("INSERT INTO logs (usuario_id, accion, detalle) VALUES (?, 'login', 'Login desde sesión web')").run(u.id);

    res.json({ token, usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol } });
});

// ── Me ────────────────────────────────────────────────────────────
router.get('/me', verificarToken, (req, res) => {
    const u = db.prepare('SELECT id, nombre, email, rol FROM usuarios WHERE id = ?').get(req.usuario.id);
    res.json(u);
});

module.exports = router;
module.exports.verificarToken = verificarToken;
module.exports.soloTecnico    = soloTecnico;
module.exports.soloSuperAdmin = soloSuperAdmin;
