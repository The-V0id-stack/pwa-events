// app.js (module)
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';
import { idb } from './idb.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { syncParticipantsFromSupabase } from './syncParticipants.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// UI elements
const statusEl = document.getElementById('status');
const sheet = document.getElementById('sheet');
const inputNombre = document.getElementById('input-nombre');
const inputCelular = document.getElementById('input-celular');
const q1 = document.getElementById('q1');
const q2 = document.getElementById('q2');
const hint = document.getElementById('sheet-hint');

let currentToken = null;
let chosen1 = null;
let chosen2 = null;

// Scanner variables (jsQR + getUserMedia)
let videoStream = null;
let videoEl = null;
let canvasEl = null;
let canvasCtx = null;
let scanRaf = null;
let scanning = false;

// Promise que indica si la sincronización inicial de participants terminó
let participantsReadyResolve;
let participantsReadyReject;
const participantsReady = new Promise((res, rej) => { participantsReadyResolve = res; participantsReadyReject = rej; });

// normalize token
function normalizeToken(t){ if(!t) return ''; t = String(t).trim(); try{return t.toUpperCase();}catch(e){return t;} }

// extract token from URL or raw text
function extractTokenFromText(text){
  try {
    const u = new URL(text);
    const p = u.searchParams.get('token');
    if (p) return p;
  } catch(e){}
  return text;
}

// show/hide sheet
async function showSheet(participant){
  inputNombre.value = participant.nombre || '';
  inputCelular.value = participant.celular || '';
  chosen1 = null; chosen2 = null;
  document.querySelectorAll('.emoji').forEach(b=>b.classList.remove('selected'));
  sheet.classList.remove('hidden');
  setTimeout(()=> sheet.classList.add('show'), 50);
}
function hideSheet(){
  sheet.classList.remove('show');
  setTimeout(()=> sheet.classList.add('hidden'), 300);
}

/**
 * Elige cámara trasera entre MediaDeviceInfo[]
 */
function chooseRearCameraId(deviceList){
  if(!deviceList || !deviceList.length) return null;
  const labels = deviceList.map(d => ({ id: d.deviceId, label: (d.label || '').toLowerCase() }));
  const prefer = labels.find(l => /back|rear|environment|trasera|posterior|rear camera/.test(l.label));
  if (prefer) return prefer.id;
  if (labels.length > 1) return labels[labels.length - 1].id;
  return labels[0].id;
}

// fuerza prompt de permisos (mejora en desktop)
async function ensureCameraPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  try {
    const constraints = { video: { facingMode: { ideal: 'environment' } } };
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    s.getTracks().forEach(t => t.stop());
    return true;
  } catch (err) {
    throw err;
  }
}

// -------- Scanner con getUserMedia + jsQR --------
async function startScanner(){
  statusEl.textContent = 'Preparando cámara…';
  // detener si había algo
  await stopScanner();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = 'API de cámara no soportada';
    return;
  }

  try {
    // forzar prompt para que labels aparezcan en desktop
    try { await ensureCameraPermission(); } catch(e) { /* ignore */ }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    if (!videoDevices.length) {
      statusEl.textContent = 'No se detectaron cámaras';
      return;
    }

    const chosenId = chooseRearCameraId(videoDevices);
    const constraints = chosenId ? { video: { deviceId: { exact: chosenId } } } : { video: { facingMode: { ideal: 'environment' } } };

    videoStream = await navigator.mediaDevices.getUserMedia(constraints);

    // crear o reutilizar video element dentro de #reader
    if (!videoEl) {
      videoEl = document.createElement('video');
      videoEl.setAttribute('playsinline', ''); // iOS
      videoEl.muted = true;
      videoEl.style.width = '100%';
      videoEl.style.height = '100%';
      const reader = document.getElementById('reader');
      if (reader) {
        reader.innerHTML = '';
        reader.appendChild(videoEl);
      } else {
        document.body.appendChild(videoEl);
      }
    }
    videoEl.srcObject = videoStream;
    await videoEl.play();

    if (!canvasEl) canvasEl = document.createElement('canvas');
    canvasCtx = canvasEl.getContext('2d');

    scanning = true;
    statusEl.textContent = 'Escaneando…';
    scanLoop();
  } catch (err) {
    console.error('startScanner error', err);
    if (err && (err.name === 'NotAllowedError' || (err.message && err.message.toLowerCase().includes('permission')))) {
      statusEl.textContent = 'Permiso de cámara denegado. Activa permisos en ajustes.';
    } else {
      statusEl.textContent = 'No se pudo iniciar la cámara. Usa HTTPS/localhost o revisa permisos.';
    }
  }
}

function scanLoop(){
  if (!scanning) return;
  if (!videoEl || videoEl.readyState !== HTMLMediaElement.HAVE_ENOUGH_DATA) {
    scanRaf = requestAnimationFrame(scanLoop);
    return;
  }

  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) {
    scanRaf = requestAnimationFrame(scanLoop);
    return;
  }
  canvasEl.width = w;
  canvasEl.height = h;
  canvasCtx.drawImage(videoEl, 0, 0, w, h);
  const imageData = canvasCtx.getImageData(0, 0, w, h);

  // jsQR global debe estar cargado desde CDN
  const code = window.jsQR ? jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" }) : null;
  if (code && code.data) {
    // evita reentradas
    if (!currentToken) {
      onScanSuccess(code.data);
    }
    return;
  }

  scanRaf = requestAnimationFrame(scanLoop);
}

async function stopScanner(){
  scanning = false;
  if (scanRaf) {
    cancelAnimationFrame(scanRaf);
    scanRaf = null;
  }
  if (videoEl) {
    try { videoEl.pause(); } catch(e){}
    // opcional: dejar el elemento para acelerar reinicios
  }
  if (videoStream) {
    try { videoStream.getTracks().forEach(t => t.stop()); } catch(e){}
    videoStream = null;
  }
}

// expose stop for console
window.stopScannerGlobal = async function() {
  await stopScanner();
  console.log('Scanner detenido.');
};

// -------- Supabase / App logic (mantener tu flujo) --------

// fetch participant from Supabase (online)
async function fetchParticipantRemote(token){
  try {
    const { data, error } = await supabase
      .from('participants')
      .select('token,nombre,celular,email')
      .eq('token', token)
      .limit(1)
      .single();
    if (error) {
      console.warn('Supabase fetch participant', error);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('fetchParticipantRemote error', err);
    return null;
  }
}

// insert response to Supabase (online)
async function insertResponseRemote(payload){
  try {
    const { data, error } = await supabase
      .from('responses')
      .insert([{
        offline_id: payload.offline_id,
        token: payload.token,
        nombre: payload.nombre,
        celular: payload.celular,
        interes: payload.interes,
        desarrollo: payload.desarrollo,
        device_ts: payload.device_ts
      }]);
    if (error) {
      throw error;
    }
    return data;
  } catch (err) {
    throw err;
  }
}

// on QR scanned (handler) — actualizado para esperar sync inicial
async function onScanSuccess(decodedText){
  if (currentToken) return;
  currentToken = normalizeToken(extractTokenFromText(decodedText));
  statusEl.textContent = `Token: ${currentToken}`;
  await stopScanner();

  // buscar local
  let participant = await idb.getParticipant(currentToken);

  // Si no lo tenemos local y la app está en proceso de sincronización,
  // esperamos corto (max 3s) por si la sync inicial trae los datos.
  if (!participant) {
    try {
      // race entre la promesa de ready y timeout 3s
      const timeout = new Promise(res => setTimeout(res, 3000, 'timeout'));
      const wait = participantsReady.then(()=> 'done').catch(()=> 'err');
      const result = await Promise.race([wait, timeout]);
      if (result === 'done') {
        participant = await idb.getParticipant(currentToken);
      }
    } catch(e){
      console.warn('Espera de sync inicial fallida', e);
    }
  }

  // si sigue sin participant y estamos online, intentar remoto
  if (!participant && navigator.onLine){
    const remote = await fetchParticipantRemote(currentToken);
    if (remote){
      participant = { token: remote.token, nombre: remote.nombre || '', celular: remote.celular || ''};
      await idb.putParticipant(participant);
    }
  }

  if (!participant){
    statusEl.textContent = 'Token no válido / no disponible offline';
    currentToken = null;
    setTimeout(()=> startScanner(), 1200);
    return;
  }

  statusEl.textContent = 'Participante encontrado';
  await showSheet(participant);
}

// wire emoji buttons
function wireEmojiButtons(){
  document.querySelectorAll('#q1 .emoji').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      document.querySelectorAll('#q1 .emoji').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      chosen1 = btn.getAttribute('data-val');
      await tryAutoSubmit();
    });
  });
  document.querySelectorAll('#q2 .emoji').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      document.querySelectorAll('#q2 .emoji').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      chosen2 = btn.getAttribute('data-val');
      await tryAutoSubmit();
    });
  });
}

// auto-submit when both chosen
async function tryAutoSubmit(){
  if (!chosen1 || !chosen2) return;
  hint.textContent = 'Enviando…';
  const offlineId = `${currentToken}-${Date.now()}`;
  const payload = {
    offline_id: offlineId,
    token: currentToken,
    nombre: inputNombre.value || '',
    celular: inputCelular.value || '',
    interes: chosen1,
    desarrollo: chosen2,
    device_ts: new Date().toISOString()
  };

  if (navigator.onLine){
    try {
      await insertResponseRemote(payload);
      hint.textContent = 'Guardado (online)';
      currentToken = null;
      hideSheet();
      setTimeout(()=> startScanner(), 400);
      return;
    } catch (err) {
      console.warn('Insert remote err', err);
      if (err && (err.code === '23505' || (err.details && String(err.details).toLowerCase().includes('duplicate')))){
        hint.textContent = 'Guardado (online - duplicado)';
        currentToken = null;
        hideSheet();
        setTimeout(()=> startScanner(), 400);
        return;
      }
    }
  }

  // guardar local si no pudo enviar online
  try {
    await idb.putResponse(payload);
    hint.textContent = 'Guardado (local)';
  } catch(e){
    console.error('Error guardando local', e);
    hint.textContent = 'Error al guardar';
  }

  currentToken = null;
  hideSheet();
  setTimeout(()=> startScanner(), 400);
}

// sync pending to Supabase
async function syncPending(){
  const pend = await idb.getPendingResponses();
  for (const r of pend){
    try {
      await insertResponseRemote(r);
      await idb.deleteResponse(r.offline_id);
      console.log('Sync OK', r.offline_id);
    } catch (err) {
      console.warn('Sync failed', err);
      if (err && (err.code === '23505' || (err.details && String(err.details).toLowerCase().includes('duplicate')))){
        await idb.deleteResponse(r.offline_id);
      }
    }
  }
}

// online listener
window.addEventListener('online', async ()=> {
  console.log('Online -> sincronizando');
  // sincronizamos participants y respuestas pendientes
  try {
    const r = await syncParticipantsFromSupabase();
    console.log('syncParticipantsFromSupabase on online:', r);
  } catch(e){
    console.warn('sync participants failed on online', e);
  }
  syncPending();
});

// register service worker
async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      console.log('Service worker registrado', reg);
    } catch (e) {
      console.warn('Error registrando SW', e);
    }
  }
}

// initialize app: registrar sw, sincronizar participants si hay internet y arrancar scanner
async function initializeApp(){
  registerSW();

  if (navigator.onLine) {
    try {
      const r = await syncParticipantsFromSupabase();
      console.log('Sincronización inicial participants:', r);
      participantsReadyResolve(true);
    } catch (err) {
      console.warn('Error sync initial participants', err);
      participantsReadyResolve(false);
    }
  } else {
    // sin internet: resolvemos para que no se quede esperando indefinidamente
    participantsReadyResolve(false);
  }

  // iniciar la UI
  startScanner();
}

// init
wireEmojiButtons();
initializeApp();

// --- Utilities for testing / debugging ---
window.testSupabase = async function testSupabase() {
  try {
    const { data, error, status } = await supabase
      .from('participants')
      .select('token')
      .limit(1);

    if (error) {
      console.error('Supabase test error:', error, 'status:', status);
      return { ok: false, error, status };
    }
    console.log('Supabase test OK — sample data:', data);
    return { ok: true, data };
  } catch (e) {
    console.error('Supabase test exception:', e);
    return { ok: false, exception: e };
  }
};

window.testScan = async function testScan(token) {
  try {
    if (!token) throw new Error('Proporciona un token. Ej: testScan("T0002-5727")');
    await onScanSuccess(token);
    return true;
  } catch (e) {
    console.error('testScan error', e);
    return false;
  }
};
