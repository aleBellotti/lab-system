# Lab System — UdeMM

Sistema de gestión de laboratorio de ingeniería. Node.js/Express + SQLite + Docker. Dispositivos ESP32 con proxy transparente. Autenticación JWT con 3 roles: `superadmin`, `tecnico`, `profesor`.

## Skill disponible

Usa `/lab-system` o el skill `lab-system` para obtener contexto completo: estructura de archivos, patrones de código, convenciones, comandos y checklist de desarrollo.

**Invoca el skill automáticamente** cuando el usuario pida:
- Agregar rutas, tablas, páginas o funcionalidades
- Modificar dispositivos ESP32, prácticas, usuarios, materias
- Hacer cambios en backend o frontend
- Preguntas sobre arquitectura o patrones del proyecto

## Reglas críticas

- Queries SQL **siempre parametrizadas** — nunca concatenar strings (seguridad)
- **Soft delete** obligatorio: `activo = 0`, nunca `DELETE`
- Código en **español** (variables, comentarios, mensajes de error al usuario)
- Frontend usa `API.request()` de `assets/js/api.js`, no fetch directo
- Migraciones de DB: `ALTER TABLE` dentro de try/catch en `database.js`
