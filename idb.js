// idb.js - wrapper pequeño para IndexedDB (promesas)
const DB_NAME = 'pwa_evento_db';
const DB_VERSION = 1;
const STORE_PARTS = 'participants';
const STORE_RESP = 'responses';

function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_PARTS)) {
        db.createObjectStore(STORE_PARTS, { keyPath: 'token' });
      }
      if (!db.objectStoreNames.contains(STORE_RESP)) {
        db.createObjectStore(STORE_RESP, { keyPath: 'offline_id' });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

async function put(store, obj){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readwrite');
    tx.objectStore(store).put(obj);
    tx.oncomplete = ()=> res(true);
    tx.onerror = ()=> rej(tx.error);
  });
}

async function get(store, key){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
  });
}

async function getAll(store){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
  });
}

async function del(store,key){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = ()=> res(true);
    tx.onerror = ()=> rej(tx.error);
  });
}

export const idb = {
  putParticipant: (p)=> put(STORE_PARTS,p),
  getParticipant: (token)=> get(STORE_PARTS,token),
  putResponse: (r)=> put(STORE_RESP,r),
  getPendingResponses: ()=> getAll(STORE_RESP),
  deleteResponse: (id)=> del(STORE_RESP,id)
};
