const DB_NAME = 'sender-db';
const DB_VERSION = 1;
const LOG_STORE = 'logs';

const identityDiv = document.querySelector('#identity');
const previewDiv = document.querySelector('#txn-preview');
const logsDiv = document.querySelector('#logs');
const exportBtn = document.querySelector('#export-txn');
const form = document.querySelector('#txn-form');
const regenerateBtn = document.querySelector('#regenerate-keys');
const refreshLogsBtn = document.querySelector('#refresh-logs');

let cachedKeyPair = null;
let cachedPublicJwk = null;
let lastTxn = null;

init().catch(console.error);

async function init() {
  await ensureDb();
  await ensureIdentity();
  attachHandlers();
  await renderLogs();
}

function attachHandlers() {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const toId = document.querySelector('#to-id').value.trim();
    const amount = Number(document.querySelector('#amount').value);
    if (!toId || !amount || Number.isNaN(amount)) {
      alert('Receiver ID and amount are required');
      return;
    }
    const txn = await createSignedTransaction({ toId, amount });
    lastTxn = txn;
    previewDiv.innerHTML = `<pre>${JSON.stringify(txn, null, 2)}</pre>`;
    exportBtn.disabled = false;
    await logEvent({
      actor: 'sender',
      action: 'create_txn',
      txn_id: txn.txn_id,
      status: 'success',
      connectivity: 'offline',
      details: { message: 'Transaction signed and ready to export' }
    });
    await renderLogs();
  });

  exportBtn.addEventListener('click', () => {
    if (!lastTxn) return;
    downloadJSON(`signed-txn-${lastTxn.txn_id}.json`, lastTxn);
  });

  regenerateBtn.addEventListener('click', async () => {
    await generateAndStoreKeys(true);
    await ensureIdentity();
    await logEvent({
      actor: 'sender',
      action: 'regen_keys',
      status: 'success',
      connectivity: 'offline',
      txn_id: null,
      details: { message: 'Device keys regenerated' }
    });
    await renderLogs();
  });

  refreshLogsBtn.addEventListener('click', renderLogs);
}

async function ensureDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOG_STORE)) {
        db.createObjectStore(LOG_STORE, { keyPath: 'log_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function ensureIdentity() {
  const deviceId = localStorage.getItem('sender_device_id') || crypto.randomUUID();
  localStorage.setItem('sender_device_id', deviceId);
  await generateAndStoreKeys(false);
  identityDiv.innerHTML = `
    <div><strong>Device ID:</strong> ${deviceId}</div>
    <div class="small muted">ECDSA P-256 keypair stored locally; public key attached to each transaction.</div>
  `;
}

async function generateAndStoreKeys(force) {
  if (cachedKeyPair && !force) return cachedKeyPair;
  const stored = localStorage.getItem('sender_keys');
  if (stored && !force) {
    const { privateJwk, publicJwk } = JSON.parse(stored);
    cachedKeyPair = await importKeyPair(privateJwk, publicJwk);
    cachedPublicJwk = publicJwk;
    return cachedKeyPair;
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  localStorage.setItem('sender_keys', JSON.stringify({ privateJwk, publicJwk }));
  cachedKeyPair = keyPair;
  cachedPublicJwk = publicJwk;
  return keyPair;
}

async function importKeyPair(privateJwk, publicJwk) {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  return { privateKey, publicKey };
}

async function createSignedTransaction({ toId, amount }) {
  const deviceId = localStorage.getItem('sender_device_id');
  const { privateKey } = cachedKeyPair || (await generateAndStoreKeys(false));
  const publicJwk = cachedPublicJwk;

  const prevHash = localStorage.getItem('sender_last_txn_hash') || '';
  const txnCore = {
    txn_id: crypto.randomUUID(),
    from_id: deviceId,
    to_id: toId,
    amount,
    timestamp: new Date().toISOString(),
    prev_hash: prevHash
  };
  const canonical = canonicalTransactionString(txnCore);
  const hashHex = await sha256Hex(canonical);
  const signature = await signHash(hashHex, privateKey);
  const fullTxn = {
    ...txnCore,
    hash: hashHex,
    signature,
    sender_public_key: publicJwk
  };
  localStorage.setItem('sender_last_txn_hash', hashHex);
  return fullTxn;
}

function canonicalTransactionString(txn) {
  const ordered = {
    txn_id: txn.txn_id,
    from_id: txn.from_id,
    to_id: txn.to_id,
    amount: Number(txn.amount),
    timestamp: txn.timestamp,
    prev_hash: txn.prev_hash ?? ''
  };
  return JSON.stringify(ordered);
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hash);
}

async function signHash(hashHex, privateKey) {
  const sigBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    hexToBuffer(hashHex)
  );
  return bufferToBase64(sigBuffer);
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
  return bytes.buffer;
}

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function logEvent(entry) {
  const db = await openDb();
  const tx = db.transaction(LOG_STORE, 'readwrite');
  const store = tx.objectStore(LOG_STORE);
  const record = {
    log_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry
  };
  store.add(record);
  return tx.complete;
}

async function renderLogs() {
  const db = await openDb();
  const tx = db.transaction(LOG_STORE, 'readonly');
  const store = tx.objectStore(LOG_STORE);
  const req = store.getAll();
  const rows = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)));
    req.onerror = () => reject(req.error);
  });
  logsDiv.innerHTML =
    rows.length === 0
      ? '<p class="muted small">No logs yet.</p>'
      : `<pre>${JSON.stringify(rows, null, 2)}</pre>`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

