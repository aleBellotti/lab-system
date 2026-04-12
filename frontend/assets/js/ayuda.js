/* ============================================================
   ayuda.js — Sistema de ayuda contextual en pantalla
   ============================================================ */

const Ayuda = (() => {

    // ── Contenidos por rol y sección ──────────────────────────
    const contenidos = {

        superadmin: {
            stats: {
                titulo: 'Estadísticas del sistema',
                items: [
                    'Muestra métricas globales: usuarios, dispositivos, prácticas y logs.',
                    'El gráfico de barras refleja los accesos de los últimos 14 días.',
                    'Las prácticas más usadas ayudan a identificar cuáles tienen mayor demanda.',
                    'El tamaño de la BD crece con el tiempo — usá "Limpiar logs" periódicamente.',
                ]
            },
            tecnicos: {
                titulo: 'Gestión de Técnicos y Admins',
                items: [
                    'Creá usuarios con rol Técnico (acceso al panel de gestión) o Super Admin.',
                    'Los Super Admins tienen acceso completo incluyendo backup y configuración.',
                    'Podés desactivar un usuario sin eliminarlo — el historial se conserva.',
                    'La columna "Último acceso" ayuda a detectar cuentas inactivas.',
                ]
            },
            config: {
                titulo: 'Configuración del sistema',
                items: [
                    'Los cambios de nombre se reflejan en la interfaz al recargar la página.',
                    '"Retención de logs" define cuántos días se conserva el historial antes de limpiarlo.',
                    'Hacer click en "Guardar cambios" aplica todos los parámetros a la vez.',
                ]
            },
            bd: {
                titulo: 'Base de datos',
                items: [
                    'SIEMPRE hacer backup antes de vaciar cualquier tabla.',
                    'El backup descarga el archivo .db completo — guardalo en lugar seguro.',
                    '"Vaciar dispositivos/prácticas" los desactiva (no los borra), el historial se conserva.',
                    '"Vaciar logs" es irreversible — borra todo el historial de actividad.',
                ]
            },
            logs: {
                titulo: 'Logs del sistema',
                items: [
                    'Muestra las últimas 50 acciones de todos los usuarios.',
                    '"Limpiar +30 días" elimina registros viejos y libera espacio.',
                    '"Limpiar todo" borra el historial completo — útil al inicio de un ciclo lectivo.',
                    'Los logs de tipo "vaciar_tabla" o "backup" solo los genera el Super Admin.',
                ]
            },
        },

        tecnico: {
            dashboard: {
                titulo: 'Dashboard',
                items: [
                    'Muestra el estado en tiempo real de todos los dispositivos ESP32.',
                    'Verificá el estado de los dispositivos al inicio de cada jornada.',
                    'Si un ESP32 figura offline, comprobá que esté encendido y en la red.',
                    'Los "Últimos accesos" muestran quién usó el sistema recientemente.',
                ]
            },
            dispositivos: {
                titulo: 'Gestión de Dispositivos',
                items: [
                    'Registrá cada ESP32 con su nombre descriptivo y dirección IP en la red.',
                    'La IP debe ser fija (estática) para garantizar la conexión siempre.',
                    'Usá "Verificar estado" para hacer ping a todos los dispositivos a la vez.',
                    'Un dispositivo desactivado no aparece en las prácticas de los profesores.',
                ]
            },
            practicas: {
                titulo: 'Gestión de Prácticas',
                items: [
                    'Orden correcto: primero creá la Materia → luego el Dispositivo → luego la Práctica.',
                    'Una práctica vincula un ESP32 con una materia y le da nombre visible.',
                    'El estado Online/Offline depende del ESP32 asignado a esa práctica.',
                    'Podés asignar el mismo ESP32 a varias prácticas si corresponde.',
                ]
            },
            materias: {
                titulo: 'Gestión de Materias',
                items: [
                    'Las materias son la categoría que organiza dispositivos, prácticas y profesores.',
                    'Creá las materias antes de registrar dispositivos o prácticas.',
                    'Los contadores de Prácticas y Profesores se actualizan automáticamente.',
                    'Desactivar una materia no elimina sus prácticas ni dispositivos asociados.',
                ]
            },
            usuarios: {
                titulo: 'Gestión de Usuarios (Profesores)',
                items: [
                    'Creá un usuario por cada docente que necesite acceso al sistema.',
                    'Asigná las materias que el profesor dicta — solo verá esas prácticas.',
                    'Podés editar un usuario para cambiar su contraseña o agregar materias.',
                    'Desactivar un usuario impide que ingrese sin perder su historial.',
                ]
            },
            logs: {
                titulo: 'Actividad del sistema',
                items: [
                    'Muestra quién accedió al sistema y qué prácticas usó.',
                    'Útil para verificar el uso del laboratorio por parte de los profesores.',
                    'Los registros de login y acceso a prácticas se generan automáticamente.',
                ]
            },
            password: {
                titulo: 'Cambiar contraseña',
                items: [
                    'Ingresá tu contraseña actual para confirmar tu identidad.',
                    'La nueva contraseña debe tener al menos 6 caracteres.',
                    'Después de cambiarla, usá la nueva contraseña en el próximo ingreso.',
                ]
            },
        },

        profesor: {
            practicas: {
                titulo: 'Mis prácticas',
                items: [
                    'Solo ves las prácticas de las materias que te asignó el técnico.',
                    'Estado verde "Disponible" → el ESP32 está encendido y podés acceder.',
                    'Estado gris "Sin conexión" → el dispositivo no responde. Avisá al técnico.',
                    'El listado se actualiza automáticamente cada 30 segundos.',
                ]
            },
        },
    };

    // ── CSS del panel de ayuda ────────────────────────────────
    function inyectarCSS() {
        if (document.getElementById('ayuda-css')) return;
        const style = document.createElement('style');
        style.id = 'ayuda-css';
        style.textContent = `
            .ayuda-btn {
                position: fixed;
                bottom: 24px;
                right: 24px;
                width: 44px;
                height: 44px;
                border-radius: 50%;
                background: #0a1e3d;
                color: white;
                border: none;
                cursor: pointer;
                font-size: 20px;
                font-weight: 700;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 12px rgba(0,0,0,.25);
                z-index: 500;
                transition: background .15s, transform .15s;
                font-family: Georgia, serif;
            }
            .ayuda-btn:hover { background: #c0392b; transform: scale(1.08); }

            .ayuda-panel {
                position: fixed;
                bottom: 80px;
                right: 24px;
                width: 320px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,.18);
                border: 1px solid #dde1e7;
                z-index: 500;
                overflow: hidden;
                transform: translateY(10px);
                opacity: 0;
                pointer-events: none;
                transition: transform .2s, opacity .2s;
            }
            .ayuda-panel.visible {
                transform: translateY(0);
                opacity: 1;
                pointer-events: all;
            }
            .ayuda-header {
                background: #0a1e3d;
                color: white;
                padding: 14px 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .ayuda-header-title { font-size: .9rem; font-weight: 700; }
            .ayuda-header-sub   { font-size: .72rem; opacity: .55; margin-top: 1px; }
            .ayuda-close {
                background: rgba(255,255,255,.12); border: none; color: white;
                width: 24px; height: 24px; border-radius: 50%;
                cursor: pointer; font-size: 14px; display: flex;
                align-items: center; justify-content: center;
                flex-shrink: 0;
            }
            .ayuda-close:hover { background: rgba(255,255,255,.25); }
            .ayuda-body { padding: 16px; }
            .ayuda-item {
                display: flex;
                gap: 10px;
                padding: 8px 0;
                border-bottom: 1px solid #f4f6f8;
                font-size: .82rem;
                color: #374151;
                line-height: 1.5;
            }
            .ayuda-item:last-child { border-bottom: none; }
            .ayuda-dot {
                width: 6px; height: 6px; border-radius: 50%;
                background: #c0392b; flex-shrink: 0; margin-top: 6px;
            }
            .ayuda-footer {
                padding: 10px 16px;
                background: #f4f6f8;
                border-top: 1px solid #dde1e7;
                font-size: .75rem;
                color: #64748b;
                text-align: center;
            }
        `;
        document.head.appendChild(style);
    }

    // ── Crear elementos del DOM ───────────────────────────────
    function crear(rol) {
        inyectarCSS();

        const btn = document.createElement('button');
        btn.className = 'ayuda-btn';
        btn.title = 'Ayuda contextual';
        btn.textContent = '?';

        const panel = document.createElement('div');
        panel.className = 'ayuda-panel';
        panel.innerHTML = `
            <div class="ayuda-header">
                <div>
                    <div class="ayuda-header-title" id="ayudaTitulo">Ayuda</div>
                    <div class="ayuda-header-sub" id="ayudaRol"></div>
                </div>
                <button class="ayuda-close" onclick="Ayuda.cerrar()">✕</button>
            </div>
            <div class="ayuda-body" id="ayudaBody"></div>
            <div class="ayuda-footer">Sistema de Laboratorio — UdeMM</div>
        `;

        document.body.appendChild(btn);
        document.body.appendChild(panel);

        btn.addEventListener('click', () => {
            panel.classList.toggle('visible');
        });

        // Cerrar al hacer click fuera
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && e.target !== btn) {
                panel.classList.remove('visible');
            }
        });

        // Mostrar info del rol
        const etiquetas = { superadmin: 'Super Administrador', tecnico: 'Técnico', profesor: 'Profesor' };
        document.getElementById('ayudaRol').textContent = etiquetas[rol] || rol;
    }

    // ── Actualizar contenido según sección activa ─────────────
    function actualizar(rol, seccion) {
        const c = contenidos[rol] && contenidos[rol][seccion];
        const titulo = document.getElementById('ayudaTitulo');
        const body   = document.getElementById('ayudaBody');
        if (!titulo || !body) return;

        if (!c) {
            titulo.textContent = 'Ayuda';
            body.innerHTML = '<div style="font-size:.82rem;color:#64748b;padding:8px 0">Seleccioná una sección del menú para ver la ayuda correspondiente.</div>';
            return;
        }

        titulo.textContent = c.titulo;
        body.innerHTML = c.items.map(item => `
            <div class="ayuda-item">
                <div class="ayuda-dot"></div>
                <div>${item}</div>
            </div>`).join('');
    }

    function cerrar() {
        const panel = document.querySelector('.ayuda-panel');
        if (panel) panel.classList.remove('visible');
    }

    return { crear, actualizar, cerrar };

})();
