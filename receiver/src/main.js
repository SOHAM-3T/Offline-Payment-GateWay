const DB_NAME = 'receiver-db';
const DB_VERSION = 1;
const LOG_STORE = 'logs';
const LEDGER_STORE = 'ledger';

const fileInput = document.querySelector('#file-input');
const statusDiv = document.querySelector('#import-status');
const ledgerDiv = document.querySelector('#ledger-view');
const logsDiv = document.querySelector('#logs');
const exportBtn = document.querySelector('#export-ledger');
const refreshLogsBtn = document.querySelector('#refresh-logs');

init().catch(console.error);

async function init() {
  await ensureDb();
  attachHandlers();
  await renderLedger();
  await renderLogs();
}

function attachHandlers() {
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const txn = JSON.parse(text);
      await handleTransaction(txn);
      statusDiv.textContent = 'Imported and processed transaction file.';
    } catch (err) {
      console.error(err);
      statusDiv.textContent = 'Failed to process file: ' + err.message;
      await logEvent({
        actor: 'receiver',
        action: 'import_txn',
        status: 'error',
        txn_id: null,
        connectivity: 'offline',
        details: { message: err.message }
      });
    } finally {
      fileInput.value = '';
      await renderLogs();
    }
  });

  exportBtn.addEventListener('click', exportLedger);
  refreshLogsBtn.addEventListener('click', renderLogs);
}

async function handleTransaction(txn) {
  validateTxnShape(txn);
  const verified = await verifyTransactionSignature(txn);
  if (!verified) {
    await logEvent({
      actor: 'receiver',
      action: 'import_txn',
      txn_id: txn.txn_id,
      status: 'error',
      connectivity: 'offline',
      details: { message: 'Signature verification failed' }
    });
    throw new Error('Signature verification failed');
  }

  const entry = await appendLedger(txn);
  await logEvent({
    actor: 'receiver',
    action: 'append_ledger',
    txn_id: txn.txn_id,
    status: 'success',
    connectivity: 'offline',
    details: { message: 'Ledger entry appended', ledger_index: entry.ledger_index }
  });
  await renderLedger();
}

function validateTxnShape(txn) {
  const required = ['txn_id', 'from_id', 'to_id', 'amount', 'timestamp', 'prev_hash', 'hash', 'signature', 'sender_public_key'];
  for (const key of required) {
    if (txn[key] === undefined || txn[key] === null) {
      throw new Error(`Transaction missing field: ${key}`);
    }
  }
}

async function verifyTransactionSignature(txn) {
  const canonical = canonicalTransactionString(txn);
  const expectedHash = await sha256Hex(canonical);
  if (expectedHash !== txn.hash) return false;

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    txn.sender_public_key,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  const sigBuffer = base64ToBuffer(txn.signature);
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    sigBuffer,
    hexToBuffer(txn.hash)
  );
  return verified;
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

async function appendLedger(txn) {
  const db = await openDb();
  const tx = db.transaction([LEDGER_STORE], 'readwrite');
  const store = tx.objectStore(LEDGER_STORE);
  const existing = await getAllLedger(store);
  const last = existing[existing.length - 1];
  const prevHash = last ? last.hash : 'GENESIS';
  const ledgerHash = await sha256Hex(prevHash + txn.hash);

  const entry = {
    ledger_index: last ? last.ledger_index + 1 : 0,
    transaction: txn,
    hash: ledgerHash,
    status: 'verified'
  };
  store.add(entry);
  await tx.complete;
  return entry;
}

async function getAllLedger(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.ledger_index - b.ledger_index));
    req.onerror = () => reject(req.error);
  });
}

async function renderLedger() {
  const db = await openDb();
  const tx = db.transaction(LEDGER_STORE, 'readonly');
  const store = tx.objectStore(LEDGER_STORE);
  const rows = await getAllLedger(store);
  ledgerDiv.innerHTML =
    rows.length === 0
      ? '<p class="muted small">No ledger entries yet.</p>'
      : `<pre>${JSON.stringify(rows, null, 2)}</pre>`;
}

async function exportLedger() {
  const db = await openDb();
  const tx = db.transaction(LEDGER_STORE, 'readonly');
  const store = tx.objectStore(LEDGER_STORE);
  const rows = await getAllLedger(store);
  if (!rows.length) {
    alert('Ledger is empty');
    return;
  }
  downloadJSON('receiver-ledger.json', rows);
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

async function ensureDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOG_STORE)) {
        db.createObjectStore(LOG_STORE, { keyPath: 'log_id' });
      }
      if (!db.objectStoreNames.contains(LEDGER_STORE)) {
        db.createObjectStore(LEDGER_STORE, { keyPath: 'ledger_index' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hash);
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

function base64ToBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
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

