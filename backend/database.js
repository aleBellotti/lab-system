const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');

const DB_PATH = path.join('/app/data', 'laboratorio.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Tablas ───────────────────────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS config (
        clave  TEXT PRIMARY KEY,
        valor  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usuarios (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre      TEXT NOT NULL,
        email       TEXT UNIQUE NOT NULL,
        password    TEXT NOT NULL,
        rol         TEXT NOT NULL CHECK(rol IN ('superadmin','tecnico','profesor')),
        activo      INTEGER DEFAULT 1,
        creado_en   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS materias (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre      TEXT NOT NULL,
        descripcion TEXT,
        activo      INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS dispositivos (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre        TEXT NOT NULL,
        ip            TEXT UNIQUE,
        mac           TEXT UNIQUE,
        descripcion   TEXT,
        materia_id    INTEGER REFERENCES materias(id),
        online        INTEGER DEFAULT 0,
        activo        INTEGER DEFAULT 1,
        ultimo_ping   TEXT,
        creado_en     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS practicas (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo          TEXT NOT NULL,
        descripcion     TEXT,
        materia_id      INTEGER REFERENCES materias(id),
        dispositivo_id  INTEGER REFERENCES dispositivos(id),
        activo          INTEGER DEFAULT 1,
        creado_en       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS logs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id      INTEGER REFERENCES usuarios(id),
        practica_id     INTEGER REFERENCES practicas(id),
        dispositivo_id  INTEGER REFERENCES dispositivos(id),
        accion          TEXT NOT NULL,
        detalle         TEXT,
        fecha           TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usuario_materia (
        usuario_id  INTEGER REFERENCES usuarios(id),
        materia_id  INTEGER REFERENCES materias(id),
        PRIMARY KEY (usuario_id, materia_id)
    );
`);

// ─── Migraciones seguras (BD existente) ───────────────────────────
// Cada bloque try/catch agrega la columna solo si no existe.
// Si ya existe, el ALTER TABLE falla silenciosamente — sin perder datos.

try {
    db.exec(`ALTER TABLE usuarios ADD COLUMN ultimo_acceso TEXT`);
} catch {}

// SQLite < 3.37 no acepta ADD COLUMN ... UNIQUE: hay que hacerlo en dos pasos.
try {
    db.exec(`ALTER TABLE dispositivos ADD COLUMN mac TEXT`);
    console.log('✅ Migración: columna mac agregada a dispositivos');
} catch {}
try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_dispositivos_mac ON dispositivos(mac) WHERE mac IS NOT NULL`);
} catch {}

// ─── Configuración por defecto ────────────────────────────────────
const configDefaults = {
    'facultad_nombre':    'Facultad de Ingeniería',
    'universidad_nombre': 'Universidad de la Marina Mercante',
    'sistema_nombre':     'Sistema de Laboratorio',
    'logs_max_dias':      '90',
    'version':            '1.1.0'
};
for (const [clave, valor] of Object.entries(configDefaults)) {
    db.prepare('INSERT OR IGNORE INTO config (clave, valor) VALUES (?, ?)').run(clave, valor);
}

// ─── Datos iniciales ──────────────────────────────────────────────
const existe = db.prepare("SELECT id FROM usuarios WHERE email = 'superadmin@lab.edu'").get();

if (!existe) {
    // ── Super Admin ──
    db.prepare(`INSERT INTO usuarios (nombre, email, password, rol)
                VALUES ('Super Administrador', 'superadmin@lab.edu', ?, 'superadmin')`)
      .run(bcrypt.hashSync('super123', 10));

    // ── Técnicos ──
    db.prepare(`INSERT INTO usuarios (nombre, email, password, rol)
                VALUES ('Técnico de Laboratorio', 'tecnico@lab.edu', ?, 'tecnico')`)
      .run(bcrypt.hashSync('tecnico123', 10));

    db.prepare(`INSERT INTO usuarios (nombre, email, password, rol)
                VALUES ('Carlos Méndez', 'cmendez@lab.edu', ?, 'tecnico')`)
      .run(bcrypt.hashSync('tecnico123', 10));

    // ── Profesores ──
    db.prepare(`INSERT INTO usuarios (nombre, email, password, rol)
                VALUES ('Dra. Ana García', 'agarcia@lab.edu', ?, 'profesor')`)
      .run(bcrypt.hashSync('profe123', 10));

    db.prepare(`INSERT INTO usuarios (nombre, email, password, rol)
                VALUES ('Ing. Roberto Martínez', 'rmartinez@lab.edu', ?, 'profesor')`)
      .run(bcrypt.hashSync('profe123', 10));

    db.prepare(`INSERT INTO usuarios (nombre, email, password, rol)
                VALUES ('Prof. Laura Sánchez', 'lsanchez@lab.edu', ?, 'profesor')`)
      .run(bcrypt.hashSync('profe123', 10));

    // ── Materias ──
    const m1 = db.prepare("INSERT INTO materias (nombre, descripcion) VALUES ('Electrónica I', 'Circuitos eléctricos básicos')").run().lastInsertRowid;
    const m2 = db.prepare("INSERT INTO materias (nombre, descripcion) VALUES ('Física II', 'Electromagnetismo y ondas')").run().lastInsertRowid;
    const m3 = db.prepare("INSERT INTO materias (nombre, descripcion) VALUES ('Sistemas Digitales', 'Lógica digital y microprocesadores')").run().lastInsertRowid;
    const m4 = db.prepare("INSERT INTO materias (nombre, descripcion) VALUES ('Programación', 'Algoritmos y estructuras de datos')").run().lastInsertRowid;

    // ── Asignar materias a profesores ──
    const garcia    = db.prepare("SELECT id FROM usuarios WHERE email='agarcia@lab.edu'").get();
    const martinez  = db.prepare("SELECT id FROM usuarios WHERE email='rmartinez@lab.edu'").get();
    const sanchez   = db.prepare("SELECT id FROM usuarios WHERE email='lsanchez@lab.edu'").get();

    db.prepare('INSERT INTO usuario_materia VALUES (?,?)').run(garcia.id, m1);
    db.prepare('INSERT INTO usuario_materia VALUES (?,?)').run(garcia.id, m2);
    db.prepare('INSERT INTO usuario_materia VALUES (?,?)').run(martinez.id, m2);
    db.prepare('INSERT INTO usuario_materia VALUES (?,?)').run(martinez.id, m3);
    db.prepare('INSERT INTO usuario_materia VALUES (?,?)').run(sanchez.id, m4);

    console.log('✅ Base de datos inicializada con usuarios de prueba');
    console.log('   superadmin@lab.edu  / super123');
    console.log('   tecnico@lab.edu     / tecnico123');
    console.log('   agarcia@lab.edu     / profe123');
}

module.exports = db;
