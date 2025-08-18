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

let chartInteres = null;
let chartDesarrollo = null;
let lastSyncTime = null;

// ---------- Helpers ----------

// Normaliza respuestas variadas a 3 buckets: 'si', 'mas o menos', 'no'
function normalizeAnswer(raw) {
  if (raw === null || raw === undefined) return 'unk';
  const s = String(raw).trim().toLowerCase();
  // emojis / variantes
  const mapYes = ['si','sí','sii','si.','si?','yes','👍','🙂','😀','😊','😀','bueno'];
  const mapMaybe = ['mas o menos','más o menos','mas o menos','mas','regular','ni fu ni fa','😐','😶','🤔'];
  const mapNo = ['no','no.','nope','👎','😞','malo'];

  if (mapYes.some(x => s.includes(x))) return 'si';
  if (mapMaybe.some(x => s.includes(x))) return 'mas o menos';
  if (mapNo.some(x => s.includes(x))) return 'no';

  // Fallback: palabras exactas
  if (s === 'si' || s === 'sí') return 'si';
  if (s === 'no') return 'no';
  if (s.includes('mas') || s.includes('más') || s.includes('regular') || s.includes('ni')) return 'mas o menos';
  return 'unk';
}

// lee todos los participantes del IndexedDB directamente (fallback si idb no expone getAll)
function readAllParticipantsFromIDB() {
  const DB_NAME = 'pwa_evento_db';
  const DB_VERSION = 1;
  const STORE = 'participants';
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) { resolve([]); return; }
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const all = store.getAll();
        all.onsuccess = () => resolve(all.result || []);
        all.onerror = () => resolve([]);
      };
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

// obtiene pendientes locales usando idb.getPendingResponses()
async function getLocalPendingResponses() {
  if (idb && typeof idb.getPendingResponses === 'function') {
    const p = await idb.getPendingResponses();
    return p || [];
  }
  return [];
}

// obtiene respuestas remotas (limit configurable)
async function fetchRemoteResponses(limit = 500) {
  try {
    const { data, error } = await supabase
      .from('responses')
      .select('offline_id,token,nombre,celular,interes,desarrollo,device_ts')
      .order('device_ts', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('fetchRemoteResponses error', error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn('fetchRemoteResponses exception', e);
    return [];
  }
}

// combina remotos + locales y deduplica por token (remote precede)
function combineAndDedupe(remote = [], local = []) {
  const map = new Map();
  // remote first (authoritative)
  for (const r of remote) {
    if (!r || !r.token) continue;
    map.set(String(r.token).trim().toUpperCase(), { ...r, __origin: 'remote' });
  }
  // then local, only if token not present
  for (const l of local) {
    if (!l || !l.token) continue;
    const key = String(l.token).trim().toUpperCase();
    if (!map.has(key)) {
      map.set(key, { ...l, __origin: 'local' });
    }
  }
  // return array most recent first (by device_ts if present)
  const arr = Array.from(map.values()).sort((a,b)=>{
    const ta = a.device_ts ? new Date(a.device_ts).getTime() : 0;
    const tb = b.device_ts ? new Date(b.device_ts).getTime() : 0;
    return tb - ta;
  });
  return arr;
}

// ---------- Renderers ----------

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
      <td class="p-2">${r.__origin || 'remote'}</td>
    `;
    elResponsesBody.appendChild(tr);
  }
}

function renderBreakdownsRows(counts) {
  // simple textual summary
  return `
    <div class="grid grid-cols-3 gap-2">
      <div class="text-xs text-gray-500">Sí</div><div class="font-semibold">${counts.si}</div><div>${Math.round(counts.siPercent)}%</div>
      <div class="text-xs text-gray-500">Mas o menos</div><div class="font-semibold">${counts['mas o menos']}</div><div>${Math.round(counts['mas o menos' + 'Percent'] || counts['mas o menosPercent'] || (counts['mas o menos']?0:0))}%</div>
      <div class="text-xs text-gray-500">No</div><div class="font-semibold">${counts.no}</div><div>${Math.round(counts.noPercent)}%</div>
      <div class="text-xs text-gray-500">Desconocido</div><div class="font-semibold">${counts.unk}</div><div>${Math.round(counts.unkPercent)}%</div>
    </div>
  `;
}

function buildChart(canvasEl, labels, values, existingChart) {
  if (existingChart) {
    existingChart.data.labels = labels;
    existingChart.data.datasets[0].data = values;
    existingChart.update();
    return existingChart;
  }
  const ctx = canvasEl.getContext('2d');
  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: ['#10B981','#F59E0B','#EF4444','#9CA3AF']
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

// ---------- Main loader ----------

async function loadLocalCounts() {
  const parts = await readAllParticipantsFromIDB();
  elTotalParts.textContent = parts ? parts.length : 0;
  const pending = await getLocalPendingResponses();
  elPending.textContent = pending ? pending.length : 0;
}

async function loadResponsesAndStats() {
  // 1) obtener remote (si online) y local pending
  const pending = await getLocalPendingResponses();
  let remote = [];
  if (navigator.onLine) {
    remote = await fetchRemoteResponses(1000);
  }

  // 2) combinar y dedup
  const combined = combineAndDedupe(remote, pending);

  // 3) generar conteos normalizados
  const countsInteres = { si:0, 'mas o menos':0, no:0, unk:0 };
  const countsDesarrollo = { si:0, 'mas o menos':0, no:0, unk:0 };

  for (const r of combined) {
    const ni = normalizeAnswer(r.interes);
    const nd = normalizeAnswer(r.desarrollo);
    countsInteres[ni] = (countsInteres[ni] || 0) + 1;
    countsDesarrollo[nd] = (countsDesarrollo[nd] || 0) + 1;
  }

  // calcular porcentajes sencillos
  const totalI = Object.values(countsInteres).reduce((s,v)=>s+v,0) || 1;
  const totalD = Object.values(countsDesarrollo).reduce((s,v)=>s+v,0) || 1;
  const labels = ['Sí','Mas o menos','No','Desconocido'];
  const valsI = [countsInteres.si, countsInteres['mas o menos'], countsInteres.no, countsInteres.unk];
  const valsD = [countsDesarrollo.si, countsDesarrollo['mas o menos'], countsDesarrollo.no, countsDesarrollo.unk];

  // render charts
  const canvasI = document.getElementById('chart-interes');
  const canvasD = document.getElementById('chart-desarrollo');
  chartInteres = buildChart(canvasI, labels, valsI, chartInteres);
  chartDesarrollo = buildChart(canvasD, labels, valsD, chartDesarrollo);

  // textual breakdowns
  const ci = {
    ...countsInteres,
    siPercent: (countsInteres.si / totalI) * 100,
    'mas o menosPercent': (countsInteres['mas o menos'] / totalI) * 100,
    noPercent: (countsInteres.no / totalI) * 100,
    unkPercent: (countsInteres.unk / totalI) * 100
  };
  const cd = {
    ...countsDesarrollo,
    siPercent: (countsDesarrollo.si / totalD) * 100,
    'mas o menosPercent': (countsDesarrollo['mas o menos'] / totalD) * 100,
    noPercent: (countsDesarrollo.no / totalD) * 100,
    unkPercent: (countsDesarrollo.unk / totalD) * 100
  };

  elBreakInteres.innerHTML = `
    <div class="text-sm text-gray-600 mb-2">Total: ${totalI}</div>
    ${renderBreakdownText(ci)}
  `;
  elBreakDesarrollo.innerHTML = `
    <div class="text-sm text-gray-600 mb-2">Total: ${totalD}</div>
    ${renderBreakdownText(cd)}
  `;

  // tabla
  renderResponsesTable(combined);
  elTotalResp.textContent = combined.length;
}

function renderBreakdownText(counts) {
  // returns small html with bars and values
  const total = Object.values(counts).reduce((s,v)=>s+(typeof v==='number'?v:0),0) || 1;
  const rows = ['si','mas o menos','no','unk'].map(k=>{
    const v = counts[k] || 0;
    const pct = Math.round((v / total) * 100);
    const label = (k==='si')? 'Sí' : (k==='mas o menos')? 'Mas o menos' : (k==='unk')? 'Desconocido' : 'No';
    return `
      <div class="mb-2">
        <div class="flex justify-between text-xs">
          <div>${label}</div>
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

// ---------- Sync & export ----------

async function forceSync() {
  if (!navigator.onLine) {
    alert('Sin internet — no se puede sincronizar ahora.');
    return;
  }
  elLastSync.textContent = 'Sincronizando...';
  try {
    await syncParticipantsFromSupabase();
    await loadLocalCounts();
    await loadResponsesAndStats();
    lastSyncTime = new Date();
    elLastSync.textContent = lastSyncTime.toLocaleString();
    localStorage.setItem('last_sync_time', new Date().toISOString());
    alert('Sincronización completada.');
  } catch (e) {
    console.error('forceSync err', e);
    alert('Error en sincronización: revisa consola.');
  }
}

async function exportCSV() {
  const pending = await getLocalPendingResponses();
  const remote = navigator.onLine ? await fetchRemoteResponses(1000) : [];
  const combined = combineAndDedupe(remote, pending);

  const rows = combined.map(r => [
    r.device_ts || '',
    r.token || '',
    (r.nombre || '').replace(/"/g,'""'),
    (r.celular || '').replace(/"/g,'""'),
    (r.interes || '').replace(/"/g,'""'),
    (r.desarrollo || '').replace(/"/g,'""'),
    r.__origin || 'remote'
  ]);
  const csv = ['fecha,token,nombre,celular,interes,desarrollo,origen', ...rows.map(r=>r.map(c=>`"${c}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `responses_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Init ----------

async function initDashboard() {
  // handlers
  btnSync.addEventListener('click', forceSync);
  btnExport.addEventListener('click', exportCSV);

  // load initial
  await loadLocalCounts();
  await loadResponsesAndStats();

  const last = localStorage.getItem('last_sync_time');
  if (last) elLastSync.textContent = new Date(last).toLocaleString();

  // recarga on online
  window.addEventListener('online', async ()=> {
    await loadLocalCounts();
    await loadResponsesAndStats();
  });
}

initDashboard();
