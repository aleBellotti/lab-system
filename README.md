# 🏛️ Sistema de Laboratorio — Facultad de Ingeniería

Sistema de gestión centralizada de prácticas de laboratorio con dispositivos ESP32.

---

## 🚀 Inicio rápido

### Requisitos
- Docker y Docker Compose instalados

### Levantar el sistema
```bash
# Clonar o copiar el proyecto
cd lab-system

# Levantar todo
docker compose up -d

# Ver logs en tiempo real
docker compose logs -f
```

El sistema estará disponible en: **http://localhost** (o la IP del servidor)

### Credenciales iniciales
| Campo | Valor |
|---|---|
| Email | admin@lab.edu |
| Contraseña | admin123 |
| Rol | Técnico administrador |

⚠️ **Cambiar la contraseña del técnico en el primer uso.**

---

## 📁 Estructura del proyecto

```
lab-system/
├── docker-compose.yml        # Orquestación de contenedores
├── nginx.conf                # Configuración del servidor web
├── backend/
│   ├── Dockerfile
│   ├── server.js             # Entrada principal + proxy ESP32
│   ├── database.js           # Inicialización SQLite
│   └── routes/
│       ├── auth.js           # Login y autenticación
│       ├── dispositivos.js   # CRUD de ESP32
│       ├── practicas.js      # CRUD de prácticas
│       └── usuarios.js       # Gestión de usuarios y logs
├── frontend/
│   ├── index.html            # Login
│   ├── panel-tecnico.html    # Panel administrador
│   ├── panel-profesor.html   # Panel profesor
│   ├── practica.html         # Vista ESP32 (iFrame)
│   └── assets/
│       ├── css/main.css      # Estilos institucionales
│       └── js/api.js         # Módulo de comunicación API
└── data/
    └── laboratorio.db        # Base de datos SQLite (auto-generada)
```

---

## 🔌 Cómo agregar un ESP32

1. Conectar el ESP32 a la red local de la facultad.
2. Anotar su dirección IP (ej: `192.x.x.x`).
3. Entrar al sistema como técnico → pestaña **Dispositivos**.
4. Click en **Nuevo dispositivo** → completar nombre, IP y materia.
5. Click en **Verificar estado** para confirmar conexión.

---

## 👤 Flujo de trabajo típico

### El técnico:
1. Registra los ESP32 con sus IPs
2. Crea las prácticas y las asocia a dispositivo + materia
3. Crea usuarios para los profesores
4. Asigna materias a cada profesor

### El profesor:
1. Entra con su usuario
2. Ve solo las prácticas de sus materias
3. Click en una práctica → aparece la interfaz del ESP32

---

## 🔧 Configuración

### Cambiar el secreto JWT
En `docker-compose.yml`:
```yaml
environment:
  - JWT_SECRET=tu_secreto_seguro_aqui
```

### Ejecutar en Raspberry Pi 3B
```bash
# Instalar Docker en Raspberry Pi OS
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Levantar el sistema
cd lab-system
docker compose up -d
```

### Backup de la base de datos
```bash
# El archivo está en ./data/laboratorio.db
cp data/laboratorio.db data/laboratorio_backup_$(date +%Y%m%d).db
```

---

## 🛠️ Comandos útiles

```bash
# Detener el sistema
docker compose down

# Reiniciar solo el backend
docker compose restart backend

# Ver logs del backend
docker compose logs backend

# Reconstruir después de cambios en el backend
docker compose up -d --build backend
```

---

## 🗄️ Estructura de la base de datos

| Tabla | Descripción |
|---|---|
| `usuarios` | Técnicos y profesores |
| `materias` | Materias de la facultad |
| `dispositivos` | ESP32 (nombre, IP, estado) |
| `practicas` | Prácticas asociadas a dispositivo + materia |
| `usuario_materia` | Qué materias puede ver cada profesor |
| `logs` | Registro de accesos y acciones |
