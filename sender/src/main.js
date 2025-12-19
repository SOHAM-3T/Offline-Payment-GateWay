import {
  generateAESKey,
  encryptAES,
  encryptAESKeyWithPublicKey,
  sha256Hex,
  signHash
} from './crypto-utils.js';

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
const receiverKeyTextarea = document.querySelector('#receiver-public-key');
const saveReceiverKeyBtn = document.querySelector('#save-receiver-key');
const receiverKeyStatus = document.querySelector('#receiver-key-status');

let cachedKeyPair = null;
let cachedPublicJwk = null;
let cachedECDHKeyPair = null; // For ECDH key exchange
let cachedECDHPublicJwk = null; // ECDH public key for export
let lastEncryptedTxn = null;
let receiverPublicKeyJwk = null;

init().catch(console.error);

async function init() {
  await ensureDb();
  await ensureIdentity();
  await loadReceiverPublicKey();
  attachHandlers();
  await renderLogs();
}

function attachHandlers() {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!receiverPublicKeyJwk) {
      alert('Please import receiver public key first');
      return;
    }
    const toId = document.querySelector('#to-id').value.trim();
    const amount = Number(document.querySelector('#amount').value);
    if (!toId || !amount || Number.isNaN(amount)) {
      alert('Receiver ID and amount are required');
      return;
    }
    try {
      const encryptedTxn = await createEncryptedSignedTransaction({ toId, amount });
      lastEncryptedTxn = encryptedTxn;
      previewDiv.innerHTML = `<pre>${JSON.stringify(encryptedTxn, null, 2)}</pre>`;
      exportBtn.disabled = false;
      await logEvent({
        actor: 'sender',
        action: 'create_encrypted_txn',
        txn_id: encryptedTxn.txn_id || 'pending',
        status: 'success',
        connectivity: 'offline',
        details: { message: 'Transaction encrypted, signed and ready to export' }
      });
      await renderLogs();
    } catch (err) {
      alert('Error creating transaction: ' + err.message);
      await logEvent({
        actor: 'sender',
        action: 'create_encrypted_txn',
        status: 'error',
        connectivity: 'offline',
        details: { message: err.message }
      });
    }
  });

  exportBtn.addEventListener('click', () => {
    if (!lastEncryptedTxn) return;
    downloadJSON(`encrypted-txn-${Date.now()}.json`, lastEncryptedTxn);
  });

  saveReceiverKeyBtn.addEventListener('click', async () => {
    try {
      const keyText = receiverKeyTextarea.value.trim();
      if (!keyText) {
        alert('Please paste receiver ECDH public key');
        return;
      }
      const keyJwk = JSON.parse(keyText);
      // Validate it's a valid ECDH public key (not ECDSA!)
      const importedKey = await crypto.subtle.importKey(
        'jwk',
        keyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
      );
      // Verify it's actually an ECDH key
      if (keyJwk.kty !== 'EC' || keyJwk.crv !== 'P-256') {
        throw new Error('Key must be ECDH P-256');
      }
      receiverPublicKeyJwk = keyJwk;
      localStorage.setItem('receiver_public_key', keyText);
      receiverKeyStatus.textContent = '✓ Receiver ECDH public key saved';
      receiverKeyStatus.style.color = 'green';
    } catch (err) {
      receiverKeyStatus.textContent = '✗ Invalid ECDH public key: ' + err.message;
      receiverKeyStatus.style.color = 'red';
      console.error('Key validation error:', err);
    }
  });

  regenerateBtn.addEventListener('click', async () => {
    await generateAndStoreKeys(true);
    // Clear ECDH keys cache to force regeneration with public key
    cachedECDHKeyPair = null;
    cachedECDHPublicJwk = null;
    localStorage.removeItem('sender_ecdh_keys');
    await ensureECDHKeyPair(); // This will regenerate with public key
    await ensureIdentity();
    await logEvent({
      actor: 'sender',
      action: 'regen_keys',
      status: 'success',
      connectivity: 'offline',
      txn_id: null,
      details: { message: 'Device keys regenerated (including ECDH keys with public key)' }
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
    // Also generate ECDH keypair for encryption
    await ensureECDHKeyPair();
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
  // Generate ECDH keypair for encryption
  await ensureECDHKeyPair();
  return keyPair;
}

async function ensureECDHKeyPair() {
  if (cachedECDHKeyPair && cachedECDHPublicJwk) return cachedECDHKeyPair;
  const stored = localStorage.getItem('sender_ecdh_keys');
  if (stored) {
    const keyData = JSON.parse(stored);
    const privateJwk = keyData.privateJwk;
    const publicJwk = keyData.publicJwk;
    
    // If public key is missing from stored data, regenerate keys
    if (!publicJwk) {
      console.warn('ECDH public key missing from storage, regenerating keys...');
      const ecdhKeyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
      );
      const newPrivateJwk = await crypto.subtle.exportKey('jwk', ecdhKeyPair.privateKey);
      const newPublicJwk = await crypto.subtle.exportKey('jwk', ecdhKeyPair.publicKey);
      localStorage.setItem('sender_ecdh_keys', JSON.stringify({ privateJwk: newPrivateJwk, publicJwk: newPublicJwk }));
      cachedECDHKeyPair = { privateKey: ecdhKeyPair.privateKey };
      cachedECDHPublicJwk = newPublicJwk;
      return cachedECDHKeyPair;
    }
    
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      privateJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    cachedECDHKeyPair = { privateKey };
    cachedECDHPublicJwk = publicJwk;
    return cachedECDHKeyPair;
  }
  const ecdhKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', ecdhKeyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', ecdhKeyPair.publicKey);
  localStorage.setItem('sender_ecdh_keys', JSON.stringify({ privateJwk, publicJwk }));
  cachedECDHKeyPair = { privateKey: ecdhKeyPair.privateKey };
  cachedECDHPublicJwk = publicJwk;
  return cachedECDHKeyPair;
}

async function loadReceiverPublicKey() {
  const stored = localStorage.getItem('receiver_public_key');
  if (stored) {
    try {
      receiverPublicKeyJwk = JSON.parse(stored);
      receiverKeyTextarea.value = stored;
      receiverKeyStatus.textContent = '✓ Receiver public key loaded';
      receiverKeyStatus.style.color = 'green';
    } catch (e) {
      // Invalid stored key
    }
  }
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

async function createEncryptedSignedTransaction({ toId, amount }) {
  const deviceId = localStorage.getItem('sender_device_id');
  const { privateKey } = cachedKeyPair || (await generateAndStoreKeys(false));
  const publicJwk = cachedPublicJwk;
  const { privateKey: ecdhPrivateKey } = await ensureECDHKeyPair();

  // Step 1: Create transaction JSON
  const prevHash = localStorage.getItem('sender_last_txn_hash') || '';
  const txnCore = {
    txn_id: crypto.randomUUID(),
    from_id: deviceId,
    to_id: toId,
    amount,
    timestamp: new Date().toISOString(),
    prev_hash: prevHash
  };

  // Step 2: Compute SHA-256 hash
  const canonical = canonicalTransactionString(txnCore);
  const hashHex = await sha256Hex(canonical);

  // Step 3: Sign hash using Sender private key (ECDSA)
  const signature = await signHash(hashHex, privateKey);

  // Create signed payload (transaction + signature + public key)
  const signedPayload = {
    ...txnCore,
    hash: hashHex,
    signature,
    sender_public_key: publicJwk
  };

  // Step 4: Generate random AES-256-GCM key
  const aesKey = await generateAESKey();

  // Step 5: Encrypt signed payload using AES key
  const { encrypted: encryptedPayload, iv } = await encryptAES(aesKey, signedPayload);

  // Step 6: Encrypt AES key using Receiver public key (ECDH)
  const encryptedAESKey = await encryptAESKeyWithPublicKey(
    aesKey,
    receiverPublicKeyJwk,
    ecdhPrivateKey
  );

  // Step 7: Export encrypted transaction file
  // Ensure ECDH public key is available
  if (!cachedECDHPublicJwk) {
    // Force reload from storage or regenerate
    await ensureECDHKeyPair();
    if (!cachedECDHPublicJwk) {
      throw new Error('ECDH public key not available. Please click "Regenerate keypair" to fix this.');
    }
  }
  
  const encryptedTxn = {
    encrypted_payload: encryptedPayload,
    encrypted_aes_key: encryptedAESKey,
    iv: iv,
    sender_public_key: publicJwk, // ECDSA public key for signature verification
    sender_ecdh_public_key: cachedECDHPublicJwk // ECDH public key for key exchange
  };

  localStorage.setItem('sender_last_txn_hash', hashHex);
  
  await logEvent({
    actor: 'sender',
    action: 'encrypt_txn',
    txn_id: txnCore.txn_id,
    status: 'success',
    connectivity: 'offline',
    details: { message: 'Transaction encrypted and signed successfully' }
  });

  return encryptedTxn;
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

// Crypto functions moved to crypto-utils.js

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

