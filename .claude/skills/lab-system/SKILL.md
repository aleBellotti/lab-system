---
name: lab-system
description: >
  Proyecto lab-system de la Facultad de Ingeniería - Universidad de la Marina Mercante (UdeMM).
  Sistema de gestión de laboratorio con dispositivos ESP32, autenticación JWT, SQLite y Docker.
  Activa este skill para obtener contexto completo del proyecto antes de hacer cambios.
  Trigger: usuario menciona "lab-system", "laboratorio", "ESP32", "practicas", o pide agregar
  rutas/tablas/páginas al sistema. Claude invoca automáticamente cuando trabaja en este repo.
tools: Read, Glob, Grep, Bash
---

# Lab System — Contexto Completo del Proyecto

## Propósito

Sistema web para gestión de laboratorios de ingeniería. Permite a técnicos registrar dispositivos ESP32, crear prácticas, y a profesores acceder a sus prácticas asignadas. Proxy transparente hacia los ESP32.

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js 18 + Express 4 |
| Frontend | HTML5 + CSS3 + JS ES6 vanilla (sin framework) |
| Base de datos | SQLite3 vía `better-sqlite3` (síncrono) |
| Auth | JWT (8h) + bcryptjs |
| Infra | Docker + Docker Compose + Nginx Alpine |
| Target HW | Raspberry Pi 3B |

## Estructura de archivos clave

```
lab-system/
├── backend/
│   ├── server.js          ← entry point, ESP32 proxy, auto-ping loop
│   ├── database.js        ← schema, migraciones, seed data
│   └── routes/
│       ├── auth.js        ← login, JWT middleware: verificarToken, soloTecnico, soloSuperAdmin
│       ├── dispositivos.js ← CRUD ESP32, registro por MAC (sin auth)
│       ├── practicas.js   ← CRUD prácticas, logs de acceso
│       ├── usuarios.js    ← CRUD usuarios, asignación profesor-materia
│       ├── materias.js    ← CRUD materias
│       └── superadmin.js  ← config sistema, auditoría
├── frontend/
│   ├── index.html             ← login, redirige según rol
│   ├── panel-tecnico.html     ← dashboard técnico
│   ├── panel-profesor.html    ← dashboard profesor
│   ├── panel-superadmin.html  ← dashboard superadmin
│   ├── practica.html          ← iframe hacia /esp32/:id
│   ├── error-dispositivo.html ← fallback device unreachable
│   └── assets/js/api.js   ← cliente fetch centralizado con token management
├── docker-compose.yml
└── nginx.conf
```

## Roles de usuario

| Rol | Acceso |
|-----|--------|
| `superadmin` | Config sistema, auditoría completa |
| `tecnico` | Todo: dispositivos, prácticas, usuarios, materias |
| `profesor` | Solo prácticas de sus materias asignadas |

## Esquema de base de datos

Tablas en `database.js`:
- `usuarios` — id, nombre, email, password_hash, rol, activo
- `materias` — id, nombre, descripcion, activo
- `dispositivos` — id, nombre, mac, ip_actual, activo, ultimo_ping, en_linea
- `practicas` — id, nombre, descripcion, dispositivo_id, materia_id, activo
- `usuario_materia` — usuario_id, materia_id (pivot profesores)
- `logs` — id, usuario_id, accion, detalle, timestamp
- `config` — clave, valor

**Soft deletes**: flag `activo` en todas las entidades — NUNCA hacer DELETE real.

## Patrones de código

### Agregar nueva ruta API

1. Crear `backend/routes/nueva.js`:
```js
const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { verificarToken, soloTecnico } = require('./auth');

router.get('/', verificarToken, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tabla WHERE activo = 1').all();
  res.json(rows);
});

module.exports = router;
```

2. Registrar en `backend/server.js`:
```js
const nuevaRoutes = require('./routes/nueva');
app.use('/api/nueva', nuevaRoutes);
```

### Agregar columna a tabla existente (migración segura)

En `database.js` dentro de `initializeDatabase()`:
```js
try {
  db.prepare('ALTER TABLE tabla ADD COLUMN nueva_col TEXT DEFAULT ""').run();
} catch (e) {
  // columna ya existe, ignorar
}
```

### Middleware de auth disponible

```js
const { verificarToken, soloTecnico, soloSuperAdmin } = require('./auth');

router.get('/publico', verificarToken, handler);          // cualquier rol
router.post('/admin', verificarToken, soloTecnico, handler);  // solo tecnico+superadmin
router.get('/super', verificarToken, soloSuperAdmin, handler); // solo superadmin
```

### Cliente API frontend

```js
// assets/js/api.js expone objeto API global
const datos = await API.request('/api/ruta', 'GET');
const nuevo = await API.request('/api/ruta', 'POST', { campo: valor });
```
Auto-maneja headers JWT y redirect a login en 401.

### Respuestas de error estándar

```js
res.status(400).json({ error: 'mensaje descriptivo' });  // validación
res.status(404).json({ error: 'No encontrado' });
res.status(409).json({ error: 'Conflicto (duplicado)' });
res.status(500).json({ error: 'Error interno' });
```

## ESP32 Proxy

`server.js` hace proxy de `/esp32/:id/*` → IP del dispositivo en DB.
- Inyecta `<base>` tag en respuestas HTML para paths relativos.
- Assets no-HTML pasan directo (sin inyección).
- Error de conexión → redirige a `error-dispositivo.html`.

## Registro de dispositivos ESP32

Flujo sin auth: ESP32 llama `POST /api/dispositivos/registro` con `{ mac, ip }`.
Backend matchea por MAC, actualiza IP y estado online. Tecnico registra MACs vía UI.

## Comandos comunes

```bash
# Desarrollo local
cd backend && npm run dev

# Docker (producción)
docker compose up -d
docker compose logs -f
docker compose up -d --build backend   # tras cambios de código

# Backup DB
cp data/laboratorio.db data/laboratorio_backup_$(date +%Y%m%d).db
```

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `JWT_SECRET` | `facultad_lab_secret_2024` | Cambiar en producción |
| `PORT` | `3000` | Puerto backend |

## Convenciones importantes

- **Idioma**: comentarios y variables en español, código JS en camelCase
- **Queries SQL**: siempre parametrizadas (`db.prepare().run(params)`) — nunca concatenar strings
- **Soft delete**: `UPDATE ... SET activo = 0` en lugar de `DELETE`
- **Logs**: registrar acciones importantes en tabla `logs` con usuario_id + accion + detalle
- **Responsive**: frontend usa CSS Grid/Flexbox, mobile-first, colores institucionales de UdeMM

## Seed data (usuarios por defecto)

| Email | Password | Rol |
|-------|----------|-----|
| superadmin@lab.com | admin123 | superadmin |
| tecnico@lab.com | tecnico123 | tecnico |
| profesor@lab.com | profesor123 | profesor |

## Checklist al agregar funcionalidad

- [ ] Ruta API con middleware correcto (verificarToken + rol)
- [ ] Queries parametrizadas (sin concatenación SQL)
- [ ] Soft delete si aplica (activo = 0, no DELETE)
- [ ] Log en tabla `logs` si es acción importante
- [ ] Migración segura si agrega columna (try/catch en ALTER TABLE)
- [ ] Frontend: función JS que llama `API.request()`, no fetch directo
- [ ] Manejo de error en frontend con mensaje al usuario
