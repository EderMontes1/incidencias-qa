// Plataforma de Incidencias QA — Ingenes. v1.1.0
// UI de solo-gestión: el contenido nace en el tablero local de cada QA
// y llega por importar.js / el empuje del clon. Aquí se consulta, se
// comenta y se cambia el estado (eso lo vigila el trigger en la base,
// no este archivo).
// La vista replica el export HTML de incidencias (app.py): tarjetas,
// píldoras por estado con conteo, mismos colores; el QA y el dev leen
// esto igual que leen el reporte.

const ESTADOS = ['Pendiente', 'En progreso', 'Duda', 'Informativo', 'Resuelta', 'Cancelada'];
const SEVERIDADES = ['Crítica', 'Alta', 'Media', 'Baja'];
// Regla del export: Duda e Informativo no llevan severidad.
const SIN_SEVERIDAD = ['Duda', 'Informativo'];

const cliente = supabase.createClient(CONFIG_NUBE.url, CONFIG_NUBE.anon);

let miPerfil = null;
let perfiles = {};          // id -> perfil
let incidencias = [];
let conteoComentarios = {}; // incidencia_id -> n
let conteoAdjuntos = {};    // incidencia_id -> n
let filtroEstado = 'todas'; // 'todas' | 'abiertas' | un estado
let registrando = false;

// ---------------------------------------------------------------
// SESIÓN
// ---------------------------------------------------------------
async function sesionInicial() {
  const { data } = await cliente.auth.getSession();
  if (data && data.session) await entrarALaApp();
}

function alternarRegistro() {
  registrando = !registrando;
  document.getElementById('login-nombre').style.display = registrando ? '' : 'none';
  document.getElementById('btn-entrar').textContent = registrando ? 'Crear cuenta y entrar' : 'Entrar';
  document.getElementById('btn-registrar').textContent = registrando ? 'Ya tengo cuenta' : 'Crear cuenta';
}

async function entrar() {
  const correo = document.getElementById('login-correo').value.trim();
  const clave = document.getElementById('login-clave').value;
  const msj = document.getElementById('msj-login');
  msj.style.color = '#c0392b';
  if (!correo || !clave) { msj.textContent = 'Falta correo o contraseña.'; return; }

  let error;
  if (registrando) {
    const nombre = document.getElementById('login-nombre').value.trim();
    ({ error } = await cliente.auth.signUp({ email: correo, password: clave, options: { data: { nombre } } }));
  } else {
    ({ error } = await cliente.auth.signInWithPassword({ email: correo, password: clave }));
  }
  if (error) { msj.textContent = error.message; return; }
  await entrarALaApp();
}

async function salir() {
  await cliente.auth.signOut();
  location.reload();
}

async function entrarALaApp() {
  const { data: { user } } = await cliente.auth.getUser();
  // maybeSingle + autocreación: una cuenta nacida ANTES de correr el
  // esquema no tiene perfil (el trigger aún no existía). Pasó el día 1.
  let { data: p } = await cliente.from('perfiles').select('*').eq('id', user.id).maybeSingle();
  if (!p) {
    await cliente.from('perfiles').insert({
      id: user.id, correo: user.email,
      nombre: (user.user_metadata || {}).nombre || ''
    });
    ({ data: p } = await cliente.from('perfiles').select('*').eq('id', user.id).maybeSingle());
  }
  if (!p) { alert('No se pudo crear tu perfil. Corre en el SQL Editor la política perfiles_crear del schema.sql.'); return; }
  miPerfil = p;
  document.getElementById('chip-usuario').innerHTML =
    `${esc(p.nombre || p.correo)} · <b>${esc(p.rol)}</b>`;
  // 'inline-block' explícito: el CSS lo trae display:none de base y un
  // '' vacío lo dejaría oculto.
  if (p.rol === 'admin') document.getElementById('btn-admin').style.display = 'inline-block';
  document.getElementById('vista-login').style.display = 'none';
  document.getElementById('vista-app').style.display = '';
  await cargarTodo();
}

// ---------------------------------------------------------------
// DATOS
// ---------------------------------------------------------------
async function cargarTodo() {
  const [rPerf, rInc, rCom, rAdj] = await Promise.all([
    cliente.from('perfiles').select('*'),
    cliente.from('incidencias').select('*').order('fecha', { ascending: false, nullsFirst: false }).order('creado', { ascending: false }),
    cliente.from('comentarios').select('incidencia_id'),
    cliente.from('adjuntos').select('incidencia_id')
  ]);
  perfiles = {};
  (rPerf.data || []).forEach(p => { perfiles[p.id] = p; });
  incidencias = rInc.data || [];
  conteoComentarios = {};
  (rCom.data || []).forEach(c => { conteoComentarios[c.incidencia_id] = (conteoComentarios[c.incidencia_id] || 0) + 1; });
  conteoAdjuntos = {};
  (rAdj.data || []).forEach(a => { conteoAdjuntos[a.incidencia_id] = (conteoAdjuntos[a.incidencia_id] || 0) + 1; });
  pintarSelects();
  repintar();
}

function pintarSelects() {
  const opcion = (v, t) => `<option value="${esc(v)}">${esc(t || v)}</option>`;
  const conTodos = (lista, titulo) => opcion('', titulo) + lista.map(v => opcion(v)).join('');

  const proyectos = [...new Set(incidencias.map(i => i.proyecto))].sort();
  const qas = [...new Set(incidencias.map(i => i.qa_id))]
    .map(id => perfiles[id]).filter(Boolean);

  const sel = (id, html) => {
    const el = document.getElementById(id);
    const previo = el.value;
    el.innerHTML = html;
    el.value = previo; // conserva el filtro al refrescar
  };
  const devs = [...new Set(incidencias.map(i => (i.dev || '').trim()).filter(Boolean))].sort();

  // ⭐ = proyecto sin nada por atender. Informativo, Cancelada y Duda
  // NO cuentan para el cálculo, así que la estrella se decide solo por
  // lo abierto: un proyecto con puras Canceladas (Fertilidad Umbrella)
  // está al 100% aunque no tenga ni una Resuelta.
  const resuelto100 = (proy) => {
    const del = incidencias.filter(i => i.proyecto === proy);
    return del.length > 0 && !del.some(i => i.estado === 'Pendiente' || i.estado === 'En progreso');
  };

  sel('f-proyecto', opcion('', 'Proyecto: todos')
    + proyectos.map(p => opcion(p, (resuelto100(p) ? '⭐ ' : '') + p)).join(''));
  sel('f-severidad', conTodos(SEVERIDADES, 'Severidad: todas'));
  sel('f-qa', opcion('', 'QA: todos') + qas.map(p => opcion(p.id, p.nombre || p.correo)).join(''));
  sel('f-dev', conTodos(devs, 'Dev: todos'));
}

// Filtros de la franja (sin el de estado: ese vive en las píldoras).
function filtroBase() {
  const fp = document.getElementById('f-proyecto').value;
  const fs = document.getElementById('f-severidad').value;
  const fq = document.getElementById('f-qa').value;
  const fd = document.getElementById('f-dev').value;
  const ft = document.getElementById('f-texto').value.trim().toLowerCase();
  return incidencias.filter(i =>
    (!fp || i.proyecto === fp) &&
    (!fs || i.severidad === fs) &&
    (!fq || i.qa_id === fq) &&
    (!fd || (i.dev || '').trim() === fd) &&
    (!ft || `${i.titulo} ${i.correo_prueba} ${i.folio}`.toLowerCase().includes(ft))
  );
}

function pasaEstado(i) {
  if (filtroEstado === 'todas') return true;
  if (filtroEstado === 'abiertas') return i.estado === 'Pendiente' || i.estado === 'En progreso';
  return i.estado === filtroEstado;
}

function repintar() {
  const base = filtroBase();
  pintarPills(base);
  pintarLista(base.filter(pasaEstado));
}

// Píldoras por estado con conteo, como el filtro embebido del export.
function pintarPills(base) {
  const conteo = {};
  base.forEach(i => { conteo[i.estado] = (conteo[i.estado] || 0) + 1; });
  const nPend = conteo['Pendiente'] || 0, nProg = conteo['En progreso'] || 0;

  const btn = (filtro, texto, ayuda) =>
    `<button class="inc-fbtn ${filtroEstado === filtro ? 'activa' : ''}" ${ayuda ? `title="${esc(ayuda)}"` : ''}
       onclick="ponFiltroEstado('${esc(filtro)}')">${esc(texto)}</button>`;

  let html = btn('todas', `Todas (${base.length})`);
  // «Por atender» solo cuando la combinación aporta: con un solo estado
  // abierto, su botón individual ya es esa vista (misma regla del export).
  if (nPend && nProg) html += btn('abiertas', `Por atender (${nPend + nProg})`, 'Pendiente + En progreso');
  for (const e of ESTADOS) if (conteo[e]) html += btn(e, `${e} (${conteo[e]})`);
  document.getElementById('fila-pills').innerHTML = html;
}

function ponFiltroEstado(f) {
  filtroEstado = (filtroEstado === f) ? 'todas' : f;
  repintar();
}

function pintarLista(lista) {
  document.getElementById('contador').textContent = `${lista.length} de ${incidencias.length}`;
  document.getElementById('lista-tarjetas').innerHTML = lista.map(i => {
    const qa = perfiles[i.qa_id] || {};
    const nCom = conteoComentarios[i.id] || 0;
    const nAdj = conteoAdjuntos[i.id] || 0;
    const sinSev = SIN_SEVERIDAD.includes(i.estado);
    const desc = i.descripcion
      ? `<div style="margin-top:6px;"><b>Descripción:</b> ${esc(recortar(i.descripcion, 220))}</div>` : '';
    // Dueño, dev o admin cambian el estado AQUÍ MISMO, sin abrir el detalle;
    // los demás ven el badge de siempre.
    const gestiona = ['dev', 'admin'].includes(miPerfil.rol) || miPerfil.id === i.qa_id;
    const estadoCard = gestiona
      ? `<select class="sel-estado ${claseEstado(i.estado)}" title="Cambiar estado"
           onclick="event.stopPropagation()"
           onchange="event.stopPropagation(); cambiarEstadoRapido('${i.id}', this)">
           ${ESTADOS.map(e => `<option ${e === i.estado ? 'selected' : ''}>${e}</option>`).join('')}
         </select>`
      : `<span class="badge ${claseEstado(i.estado)}">${esc(i.estado)}</span>`;
    return `<div class="tarjeta-inc" onclick="abrirDetalle('${i.id}')">
      <div class="titulo-inc"><span>#${esc(i.folio || '')} · ${esc(i.titulo)}</span>${estadoCard}</div>
      <div class="fila-badges">
        ${sinSev ? '' : `<span class="badge sev-${esc(i.severidad)}">${esc(i.severidad)}</span>`}
        ${badgesFormulario(i.formulario)}
        ${i.dev ? `· <b>Asignado:</b> ${esc(i.dev)}` : ''}
      </div>
      ${i.correo_prueba ? `<div><b>Correo de prueba:</b> ${esc(i.correo_prueba)}</div>` : ''}
      ${desc}
      <div class="pie-tarjeta">${esc(i.fecha || '')} · ${esc(i.proyecto)} · ${esc(qa.nombre || qa.correo || '')}${nAdj ? ` · 📎 ${nAdj}` : ''}${nCom ? ` · 💬 ${nCom}` : ''}</div>
    </div>`;
  }).join('') || '<i style="color:#5f6f7d;">Sin incidencias.</i>';
}

// ---------------------------------------------------------------
// DETALLE
// ---------------------------------------------------------------
async function abrirDetalle(id) {
  const i = incidencias.find(x => x.id === id);
  if (!i) return;
  const qa = perfiles[i.qa_id] || {};
  const puedeGestionar = ['dev', 'admin'].includes(miPerfil.rol) || miPerfil.id === i.qa_id;
  const sinSev = SIN_SEVERIDAD.includes(i.estado);

  const [rCom, rHist, rAdj] = await Promise.all([
    cliente.from('comentarios').select('*').eq('incidencia_id', id).order('creado'),
    cliente.from('historial_estado').select('*').eq('incidencia_id', id).order('cuando'),
    cliente.from('adjuntos').select('*').eq('incidencia_id', id)
  ]);

  const comentarios = (rCom.data || []).map(c => {
    const a = perfiles[c.autor] || {};
    return `<div class="comentario">
      <div class="quien">${esc(a.nombre || a.correo || '?')} · ${fechaCorta(c.creado)}</div>
      <div>${esc(c.texto)}</div></div>`;
  }).join('') || '<div style="color:#8a979f;">—</div>';

  const historial = (rHist.data || []).map(h => {
    const p = perfiles[h.por] || {};
    return `<div class="evento-historial">${esc(h.de)} → <b>${esc(h.a)}</b> · ${esc(p.nombre || p.correo || '?')} · ${fechaCorta(h.cuando)}</div>`;
  }).join('');

  document.getElementById('panel-detalle').innerHTML = `
    <button id="btn-cerrar-detalle" onclick="cerrarDetalle()" title="Cerrar">✕</button>
    <div class="fila-badges">
      ${sinSev ? '' : `<span class="badge sev-${esc(i.severidad)}">${esc(i.severidad)}</span>`}
      <span class="badge ${claseEstado(i.estado)}">${esc(i.estado)}</span>
      ${badgesFormulario(i.formulario)}
    </div>
    <h2>#${esc(i.folio || '')} · ${esc(i.titulo)}</h2>
    <div class="meta-detalle">${esc(i.proyecto)} · ${esc(i.fecha || '')} ·
      QA: ${esc(qa.nombre || qa.correo || '')}${i.correo_prueba ? ' · ' + esc(i.correo_prueba) : ''}</div>

    ${puedeGestionar ? `
    <div class="fila-gestion">
      <select id="g-estado">${ESTADOS.map(e => `<option ${e === i.estado ? 'selected' : ''}>${e}</option>`).join('')}</select>
      <input type="text" id="g-dev" placeholder="Dev asignado" value="${esc(i.dev || '')}">
      <button id="btn-guardar-gestion" onclick="guardarGestion('${i.id}')">Guardar</button>
    </div>
    <div id="msj-gestion"></div>` : ''}

    ${i.descripcion ? `<div class="campo-detalle"><label>Descripción</label><div>${esc(i.descripcion)}</div></div>` : ''}
    ${i.pasos ? `<div class="campo-detalle"><label>Pasos para reproducir</label><div>${esc(i.pasos)}</div></div>` : ''}
    <div id="zona-adjuntos"></div>

    <div class="campo-detalle"><label>Comentarios</label>${comentarios}</div>
    <textarea id="caja-comentario" placeholder="Escribe un comentario"></textarea>
    <button id="btn-comentar" onclick="comentar('${i.id}')">Comentar</button>

    ${historial ? `<div class="campo-detalle" style="margin-top:16px;"><label>Historial de estado</label>${historial}</div>` : ''}
  `;

  // Los adjuntos se piden con URL firmada (bucket privado): sin sesión no hay imagen.
  const zona = document.getElementById('zona-adjuntos');
  if ((rAdj.data || []).length) {
    zona.className = 'campo-detalle';
    zona.innerHTML = '<label>Adjuntos</label>';
    for (const a of rAdj.data) {
      const { data } = await cliente.storage.from('adjuntos').createSignedUrl(a.ruta, 3600);
      if (data && data.signedUrl) {
        zona.innerHTML += `<a href="${data.signedUrl}" target="_blank" title="${esc(a.nombre)}">
          <img class="adjunto-mini" src="${data.signedUrl}" alt="${esc(a.nombre)}"></a>`;
      }
    }
  }

  document.getElementById('fondo-detalle').style.display = 'block';
  document.getElementById('panel-detalle').style.display = 'block';
}

function cerrarDetalle() {
  document.getElementById('fondo-detalle').style.display = 'none';
  document.getElementById('panel-detalle').style.display = 'none';
}

// Cambio de estado desde la card, sin abrir el detalle. Si la nube lo
// rechaza (p. ej. permisos), el selector se regresa al estado real.
async function cambiarEstadoRapido(id, sel) {
  const i = incidencias.find(x => x.id === id);
  const { error } = await cliente.from('incidencias').update({ estado: sel.value }).eq('id', id);
  if (error) { alert(error.message); sel.value = i.estado; return; }
  i.estado = sel.value;
  repintar();
}

async function guardarGestion(id) {
  const estado = document.getElementById('g-estado').value;
  const dev = document.getElementById('g-dev').value.trim();
  const msj = document.getElementById('msj-gestion');
  const { error } = await cliente.from('incidencias').update({ estado, dev }).eq('id', id);
  if (error) { msj.style.color = '#c0392b'; msj.textContent = error.message; return; }
  msj.style.color = '#1e8449';
  msj.textContent = '✓ guardado';
  await cargarTodo();
  abrirDetalle(id);
}

async function comentar(id) {
  const caja = document.getElementById('caja-comentario');
  const texto = caja.value.trim();
  if (!texto) return;
  const { error } = await cliente.from('comentarios').insert({ incidencia_id: id, autor: miPerfil.id, texto });
  if (error) { alert(error.message); return; }
  caja.value = '';
  conteoComentarios[id] = (conteoComentarios[id] || 0) + 1;
  repintar();
  abrirDetalle(id);
}

// ---------------------------------------------------------------
// PANEL ADMIN (solo rol admin: roles y bitácora)
// ---------------------------------------------------------------
let adminPestana = 'usuarios';

async function abrirAdmin() {
  const pill = (p, texto) =>
    `<button class="inc-fbtn ${adminPestana === p ? 'activa' : ''}" onclick="adminPestana='${p}';abrirAdmin()">${texto}</button>`;

  let cuerpo = '';
  if (adminPestana === 'usuarios') {
    const { data: lista } = await cliente.from('perfiles').select('*').order('creado');
    cuerpo = `<table class="tabla-admin">
      <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th></th></tr></thead>
      <tbody>${(lista || []).map(p => `
        <tr>
          <td>${esc(p.nombre || '—')}</td>
          <td>${esc(p.correo)}</td>
          <td><select id="rol-${p.id}" ${p.id === miPerfil.id ? 'disabled title="Tu propio rol no se cambia desde aquí"' : ''}>
            ${['qa', 'dev', 'admin'].map(r => `<option ${r === p.rol ? 'selected' : ''}>${r}</option>`).join('')}
          </select></td>
          <td>${p.id === miPerfil.id ? '' : `<button class="inc-fbtn" onclick="cambiarRol('${p.id}')">Guardar</button>`}
              <span id="msj-rol-${p.id}" style="font-size:12px;color:#1e8449;"></span></td>
        </tr>`).join('')}
      </tbody></table>`;
  } else {
    const { data: lista, error } = await cliente.from('bitacora').select('*').order('cuando', { ascending: false }).limit(300);
    if (error) cuerpo = `<div style="color:#c0392b;">${esc(error.message)} — ¿ya corriste migracion_admin.sql?</div>`;
    else cuerpo = `<table class="tabla-admin">
      <thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Detalle</th></tr></thead>
      <tbody>${(lista || []).map(b => {
        const p = perfiles[b.quien] || {};
        const inc = incidencias.find(x => x.id === b.incidencia_id);
        const ref = inc ? `#${inc.folio} ${inc.titulo}` : '';
        return `<tr>
          <td style="white-space:nowrap;">${fechaCorta(b.cuando)}</td>
          <td>${esc(p.nombre || p.correo || '?')}</td>
          <td style="white-space:nowrap;">${esc(b.accion)}</td>
          <td>${esc(b.detalle || '')}${ref ? ` <span style="color:#5f6f7d;">· ${esc(recortar(ref, 70))}</span>` : ''}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  document.getElementById('panel-detalle').innerHTML = `
    <button id="btn-cerrar-detalle" onclick="cerrarDetalle()" title="Cerrar">✕</button>
    <h2>Administración</h2>
    <div style="display:flex;gap:8px;margin:12px 0;">${pill('usuarios', 'Usuarios')}${pill('bitacora', 'Bitácora')}</div>
    ${cuerpo}`;
  document.getElementById('fondo-detalle').style.display = 'block';
  document.getElementById('panel-detalle').style.display = 'block';
}

async function cambiarRol(id) {
  const rol = document.getElementById('rol-' + id).value;
  const msj = document.getElementById('msj-rol-' + id);
  const { error } = await cliente.from('perfiles').update({ rol }).eq('id', id);
  if (error) { msj.style.color = '#c0392b'; msj.textContent = error.message; return; }
  msj.style.color = '#1e8449';
  msj.textContent = '✓ guardado';
  perfiles[id].rol = rol;
}

// ---------------------------------------------------------------
// UTILERÍAS
// ---------------------------------------------------------------
function claseEstado(e) { return 'est-' + String(e || '').replace(/\s/g, ''); }
// 'DIG+VERT' pinta las DOS etiquetas, cada una con su color — misma
// regla del export (nunca la palabra «Ambos»).
function badgesFormulario(f) {
  return String(f || '').split('+').filter(Boolean)
    .map(x => `<span class="badge form-${esc(x)}">${esc(x)}</span>`).join('');
}
function fechaCorta(ts) { return String(ts || '').slice(0, 16).replace('T', ' '); }
function recortar(t, n) { t = String(t); return t.length > n ? t.slice(0, n) + '…' : t; }
function esc(t) {
  return String(t == null ? '' : t)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

console.log('Plataforma Incidencias QA v1.4.0');
sesionInicial();
