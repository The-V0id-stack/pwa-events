// dashboard/dashboard.js (module)
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabase-config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { idb } from '../idb.js';
import { syncParticipantsFromSupabase } from '../syncParticipants.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// UI refs
const elTotalParts = document.getElementById('total-participants');
const elTotalResp = document.getElementById('total-responses');
const elPending = document.getElementById('pending-count');
const elBreakInteres = document.getElementById('break-interes');
const elBreakDesarrollo = document.getElementById('break-desarrollo');
const elResponsesBody = document.getElementById('responses-body');
const elLastSync = document.getElementById('last-sync');

const btnSync = document.getElementById('btn-sync');
const btnExport = document.getElementById('btn-export');

let lastSyncTime = null;

async function loadLocalCounts() {
  // participantes locales
  const parts = await idb.getAllParticipants ? idb.getAllParticipants() : [];
  elTotalParts.textContent = parts ? parts.length : 0;

  // respuestas locales (pendientes y guardadas localmente)
  const pending = await idb.getPendingResponses();
  elPending.textContent = pending ? pending.length : 0;
}

// obtén respuestas: si online trae desde supabase (limitado), si offline usa locales
async function loadResponsesAndStats() {
  let responses = [];
  if (navigator.onLine) {
    try {
      // Traer últimas 200 respuestas (ajusta si hace falta)
      const { data, error } = await supabase
        .from('responses')
        .select('offline_id, token, nombre, celular, interes, desarrollo, device_ts')
        .order('device_ts', { ascending: false })
        .limit(200);

      if (!error && data) {
        responses = data;
      } else {
        console.warn('supabase responses fetch err', error);
      }
    } catch (e) {
      console.warn('error fetching remote responses', e);
    }
  }

  // añadir responses locales pendientes (para verlas aunque estemos online)
  const pending = await idb.getPendingResponses();
  if (pending && pending.length) {
    // marca origen
    const pEnriched = pending.map(p => ({ ...p, __origin: 'local' }));
    responses = pEnriched.concat(responses || []);
  }

  // si no obtuviste nada remoto, carga lo local (si guardaste alguna copia)
  if ((!responses || responses.length === 0) && !navigator.onLine) {
    // no hay online: solo mostramos pendientes
    responses = pending || [];
  }

  renderResponsesTable(responses);
  renderBreakdowns(responses);
  elTotalResp.textContent = responses.length;
}

function renderResponsesTable(rows) {
  elResponsesBody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2">${r.device_ts ? new Date(r.device_ts).toLocaleString() : '-'}</td>
      <td class="p-2">${r.token || '-'}</td>
      <td class="p-2">${r.nombre || '-'}</td>
      <td class="p-2">${r.celular || '-'}</td>
      <td class="p-2">${r.interes || '-'}</td>
      <td class="p-2">${r.desarrollo || '-'}</td>
      <td class="p-2">${r.__origin ? r.__origin : 'remote'}</td>
    `;
    elResponsesBody.appendChild(tr);
  }
}

function renderBreakdowns(rows) {
  const interesCounts = { si:0, 'mas o menos':0, no:0, unk:0 };
  const desarrolloCounts = { si:0, 'mas o menos':0, no:0, unk:0 };

  for (const r of rows) {
    const a = String(r.interes || '').toLowerCase();
    if (a.includes('si')) interesCounts.si++;
    else if (a.includes('mas') || a.includes('mas o menos') || a.includes('mas o')) interesCounts['mas o menos']++;
    else if (a.includes('no')) interesCounts.no++;
    else interesCounts.unk++;

    const b = String(r.desarrollo || '').toLowerCase();
    if (b.includes('si')) desarrolloCounts.si++;
    else if (b.includes('mas') || b.includes('mas o menos') || b.includes('mas o')) desarrolloCounts['mas o menos']++;
    else if (b.includes('no')) desarrolloCounts.no++;
    else desarrolloCounts.unk++;
  }

  elBreakInteres.innerHTML = simpleBarHtml(interesCounts);
  elBreakDesarrollo.innerHTML = simpleBarHtml(desarrolloCounts);
}

function simpleBarHtml(counts) {
  const total = Object.values(counts).reduce((s,v)=>s+v,0) || 1;
  const rows = Object.entries(counts).map(([k,v]) => {
    const pct = Math.round((v/total)*100);
    return `
      <div class="mb-2">
        <div class="flex justify-between text-xs">
          <div class="capitalize">${k}</div>
          <div>${v} (${pct}%)</div>
        </div>
        <div class="w-full bg-gray-200 h-2 rounded mt-1">
          <div style="width:${pct}%" class="h-2 bg-blue-600 rounded"></div>
        </div>
      </div>
    `;
  }).join('');
  return rows;
}

// FORZAR sincronización: participants + syncPending
async function forceSync() {
  if (!navigator.onLine) {
    alert('Sin internet — no se puede sincronizar ahora.');
    return;
  }
  elLastSync.textContent = 'Sincronizando...';
  try {
    const r = await syncParticipantsFromSupabase();
    // luego forzar subida de pendientes via endpoint principal (window parent maybe)
    // Si la lógica de syncPending está en app.js, puedes llamarla si compartes window (no en distintos tabs)
    // Aquí hacemos un fetch simple para reconsultar local counts
    await loadLocalCounts();
    await loadResponsesAndStats();
    lastSyncTime = new Date();
    elLastSync.textContent = lastSyncTime.toLocaleString();
    alert('Sincronización completada.');
  } catch (e) {
    console.error('forceSync err', e);
    alert('Error en sincronización: revisa consola.');
  }
}

// export CSV de respuestas (usa los datos que renderizamos)
async function exportCSV() {
  // tomar respuestas mostradas
  const rows = [];
  // combine pending local + remote latest
  let remote = [];
  if (navigator.onLine) {
    const { data, error } = await supabase
      .from('responses')
      .select('offline_id, token, nombre, celular, interes, desarrollo, device_ts')
      .order('device_ts', { ascending: false })
      .limit(1000);
    if (!error && data) remote = data;
  }
  const pending = await idb.getPendingResponses();
  const combined = (pending || []).concat(remote || []);
  for (const r of combined) {
    rows.push([r.device_ts || '', r.token || '', r.nombre || '', r.celular || '', r.interes || '', r.desarrollo || '']);
  }
  const csv = ['fecha,token,nombre,celular,interes,desarrollo', ...rows.map(r=> r.map(c=>`"${String(c||'').replace(/"/g,'""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `responses_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// inicialización
async function initDashboard() {
  // cargar contadores locales
  await loadLocalCounts();
  // cargar respuestas y stats
  await loadResponsesAndStats();

  // mostrar última sync si la hay (guardada en localStorage)
  const last = localStorage.getItem('last_sync_time');
  if (last) {
    elLastSync.textContent = new Date(last).toLocaleString();
  }

  // handlers
  btnSync.addEventListener('click', async ()=> {
    await forceSync();
    localStorage.setItem('last_sync_time', new Date().toISOString());
  });
  btnExport.addEventListener('click', exportCSV);

  // re-cargar al reconectar
  window.addEventListener('online', async ()=> {
    await loadLocalCounts();
    await loadResponsesAndStats();
  });
}

initDashboard();
