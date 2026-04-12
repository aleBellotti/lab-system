/* ============================================================
   api.js — Módulo central de comunicación con el backend
   Todos los fetch() pasan por aquí
   ============================================================ */

const API = (() => {

    const BASE = '/api';

    // ── Helper interno ──────────────────────────────────────
    async function request(method, path, body = null) {
        const token = localStorage.getItem('token');

        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };

        if (token) opts.headers['Authorization'] = `Bearer ${token}`;
        if (body)  opts.body = JSON.stringify(body);

        const res = await fetch(BASE + path, opts);

        // Token expirado → volver al login
        if (res.status === 401) {
            localStorage.clear();
            window.location.href = '/index.html';
            return;
        }

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || `Error ${res.status}`);
        }

        return data;
    }

    // ── Auth ────────────────────────────────────────────────
    async function login(email, password) {
        return request('POST', '/auth/login', { email, password });
    }

    function logout() {
        localStorage.clear();
        window.location.href = '/index.html';
    }

    function getUsuario() {
        const u = localStorage.getItem('usuario');
        return u ? JSON.parse(u) : null;
    }

    function requireAuth(rolRequerido = null) {
        const u = getUsuario();
        const token = localStorage.getItem('token');
        if (!u || !token) {
            window.location.href = '/index.html';
            return null;
        }
        // superadmin y tecnico pueden acceder al panel técnico
        if (rolRequerido === 'tecnico' && !['tecnico','superadmin'].includes(u.rol)) {
            window.location.href = '/index.html';
            return null;
        }
        if (rolRequerido === 'superadmin' && u.rol !== 'superadmin') {
            window.location.href = '/index.html';
            return null;
        }
        return u;
    }

    function esSuperAdmin() {
        const u = getUsuario();
        return u && u.rol === 'superadmin';
    }

    function esTecnico() {
        const u = getUsuario();
        return u && ['tecnico','superadmin'].includes(u.rol);
    }

    // ── Dispositivos ────────────────────────────────────────
    const dispositivos = {
        listar:   ()       => request('GET',    '/dispositivos'),
        obtener:  (id)     => request('GET',    `/dispositivos/${id}`),
        crear:    (data)   => request('POST',   '/dispositivos', data),
        actualizar:(id, d) => request('PUT',    `/dispositivos/${id}`, d),
        eliminar: (id)     => request('DELETE', `/dispositivos/${id}`),
        materias: ()       => request('GET',    '/dispositivos/materias/lista'),
        ping:     (id)     => request('GET',    `/ping/${id}`),
    };

    // ── Prácticas ────────────────────────────────────────────
    const practicas = {
        listar:    ()       => request('GET',    '/practicas'),
        obtener:   (id)     => request('GET',    `/practicas/${id}`),
        crear:     (data)   => request('POST',   '/practicas', data),
        actualizar:(id, d)  => request('PUT',    `/practicas/${id}`, d),
        eliminar:  (id)     => request('DELETE', `/practicas/${id}`),
    };

    // ── Usuarios ─────────────────────────────────────────────
    const usuarios = {
        listar:          ()         => request('GET',    '/usuarios'),
        crear:           (data)     => request('POST',   '/usuarios', data),
        actualizar:      (id, data) => request('PUT',    `/usuarios/${id}`, data),
        materias:        (id)       => request('GET',    `/usuarios/${id}/materias`),
        asignarMateria:  (id, mid)  => request('POST',   `/usuarios/${id}/materias`, { materia_id: mid }),
        quitarMateria:   (id, mid)  => request('DELETE', `/usuarios/${id}/materias/${mid}`),
        logs:            ()         => request('GET',    '/usuarios/logs/recientes'),
        cambiarPassword: (data)     => request('PUT',    '/usuarios/mi-cuenta/password', data),
    };

    // ── Materias ─────────────────────────────────────────────
    const materias = {
        listar:    ()       => request('GET',    '/materias'),
        crear:     (data)   => request('POST',   '/materias', data),
        actualizar:(id, d)  => request('PUT',    `/materias/${id}`, d),
        eliminar:  (id)     => request('DELETE', `/materias/${id}`),
    };

    // ── Dashboard ─────────────────────────────────────────────
    const dashboard = {
        resumen: () => request('GET', '/dashboard'),
    };

    // ── Super Admin ───────────────────────────────────────────
    const sa = {
        stats:          ()         => request('GET',    '/sa/stats'),
        config:         ()         => request('GET',    '/sa/config'),
        guardarConfig:  (data)     => request('PUT',    '/sa/config', data),
        limpiarLogs:    (dias)     => request('DELETE', `/sa/logs${dias ? '?dias='+dias : ''}`),
        vaciarTabla:    (tabla)    => request('DELETE', `/sa/vaciar/${tabla}`),
        backupUrl:      ()         => '/api/sa/backup',
        tecnicos:       ()         => request('GET',    '/sa/tecnicos'),
        crearTecnico:   (data)     => request('POST',   '/sa/tecnicos', data),
        actualizarTecnico:(id,d)   => request('PUT',    `/sa/tecnicos/${id}`, d),
        // Diagnóstico
        diag: {
            estado:       ()       => request('GET',  '/sa/diagnostico/estado'),
            pingTodos:    ()       => request('POST', '/sa/diagnostico/ping-todos', {}),
            ping:         (id)     => request('POST', `/sa/diagnostico/ping/${id}`, {}),
            forzarOnline: (id, v)  => request('PUT',  `/sa/diagnostico/online/${id}`, { online: v }),
            cambiarIP:    (id, ip) => request('PUT',  `/sa/diagnostico/ip/${id}`, { ip }),
            testESP32:    (id)     => request('GET',  `/sa/diagnostico/test-esp32/${id}`),
            escanearRed:  (data)   => request('POST', '/sa/diagnostico/escanear-red', data),
        }
    };

    // ── Utilidades UI ────────────────────────────────────────
    function mostrarAlerta(elementId, tipo, mensaje) {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.className = `alert alert-${tipo === 'ok' ? 'success' : tipo === 'error' ? 'error' : tipo}`;
        el.innerHTML = mensaje;
        el.style.display = 'flex';
        if (tipo === 'ok' || tipo === 'success') setTimeout(() => el.style.display = 'none', 3000);
    }

    function abrirModal(id) {
        document.getElementById(id).classList.add('active');
    }

    function cerrarModal(id) {
        document.getElementById(id).classList.remove('active');
    }

    function poblarSelect(selectId, items, valueKey, labelKey, placeholder = 'Seleccionar...') {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        sel.innerHTML = `<option value="">${placeholder}</option>`;
        items.forEach(i => {
            const opt = document.createElement('option');
            opt.value = i[valueKey];
            opt.textContent = i[labelKey];
            sel.appendChild(opt);
        });
    }

    return {
        login, logout, getUsuario, requireAuth, esSuperAdmin, esTecnico,
        dispositivos, practicas, usuarios, materias, dashboard, sa,
        mostrarAlerta, abrirModal, cerrarModal, poblarSelect
    };

})();
