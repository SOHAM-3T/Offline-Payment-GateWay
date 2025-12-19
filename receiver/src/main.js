import {
  decryptAES,
  decryptAESKeyWithPrivateKey,
  sha256Hex,
  verifySignature,
  generateAESKey,
  encryptAES,
  encryptAESKeyWithPublicKey,
  signHash
} from './crypto-utils.js';

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
const identityDiv = document.querySelector('#identity');
const regenerateBtn = document.querySelector('#regenerate-keys');
const exportPublicKeyBtn = document.querySelector('#export-public-key');
const bankKeyTextarea = document.querySelector('#bank-public-key');
const saveBankKeyBtn = document.querySelector('#save-bank-key');
const bankKeyStatus = document.querySelector('#bank-key-status');

// KYC elements
const kycStatusDiv = document.querySelector('#kyc-status');
const kycForm = document.querySelector('#kyc-form');
const kycMessageDiv = document.querySelector('#kyc-message');

const BANK_API_URL = localStorage.getItem('bank_api_url') || 'http://localhost:4000';

let cachedKeyPair = null;
let cachedPublicJwk = null;
let cachedECDHKeyPair = null;
let cachedECDHPublicJwk = null; // ECDH public key for export
let bankPublicKeyJwk = null;
let userInfo = null;

init().catch(console.error);

async function init() {
  await ensureDb();
  await ensureIdentity();
  await loadBankPublicKey();
  await loadUserInfo();
  attachHandlers();
  await renderKYCStatus();
  await renderLedger();
  await renderLogs();
}

function attachHandlers() {
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const encryptedData = JSON.parse(text);
      await handleEncryptedTransaction(encryptedData);
      statusDiv.textContent = 'Decrypted, verified, and processed transaction file.';
    } catch (err) {
      console.error(err);
      statusDiv.textContent = 'Failed to process file: ' + err.message;
      await logEvent({
        actor: 'receiver',
        action: 'import_encrypted_txn',
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

  exportBtn.addEventListener('click', exportEncryptedLedger);
  refreshLogsBtn.addEventListener('click', renderLogs);
  
  regenerateBtn.addEventListener('click', async () => {
    try {
      // Clear all key caches
      cachedKeyPair = null;
      cachedPublicJwk = null;
      cachedECDHKeyPair = null;
      cachedECDHPublicJwk = null;
      
      // Remove from localStorage to force regeneration
      localStorage.removeItem('receiver_keys');
      localStorage.removeItem('receiver_ecdh_keys');
      
      // Regenerate both ECDSA and ECDH keypairs
      await generateAndStoreKeys(true);
      await ensureECDHKeyPair();
      await ensureIdentity();
      
      await logEvent({
        actor: 'receiver',
        action: 'regen_keys',
        status: 'success',
        connectivity: 'offline',
        details: { 
          message: 'All Receiver keys regenerated (ECDSA + ECDH). Export new public key and update Sender!' 
        }
      });
      
      alert('Keys regenerated successfully! Now click "Export Public Key" to get the new ECDH public key for the Sender.');
      await renderLogs();
    } catch (err) {
      console.error('Error regenerating keys:', err);
      alert('Error regenerating keys: ' + err.message);
    }
  });
  
  exportPublicKeyBtn.addEventListener('click', async () => {
    // Ensure ECDH keys are generated
    await ensureECDHKeyPair();
    if (!cachedECDHPublicJwk) {
      alert('Error: ECDH public key not available. Please regenerate keys.');
      return;
    }
    // Export ECDH public key (not ECDSA!) - this is what Sender needs for encryption
    downloadJSON('receiver-public-key.json', cachedECDHPublicJwk);
  });
  
  saveBankKeyBtn.addEventListener('click', async () => {
    try {
      const keyText = bankKeyTextarea.value.trim();
      if (!keyText) {
        alert('Please paste bank public key');
        return;
      }
      const keyJwk = JSON.parse(keyText);
      await crypto.subtle.importKey(
        'jwk',
        keyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
      );
      bankPublicKeyJwk = keyJwk;
      localStorage.setItem('bank_public_key', keyText);
      bankKeyStatus.textContent = '✓ Bank public key saved';
      bankKeyStatus.style.color = 'green';
    } catch (err) {
      bankKeyStatus.textContent = '✗ Invalid public key: ' + err.message;
      bankKeyStatus.style.color = 'red';
    }
  });

  // KYC form handler
  kycForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = document.querySelector('#kyc-full-name').value.trim();
    const emailOrPhone = document.querySelector('#kyc-email-phone').value.trim();
    const bankId = document.querySelector('#kyc-bank-id').value.trim();
    
    if (!fullName || !emailOrPhone || !bankId) {
      kycMessageDiv.textContent = 'All fields are required';
      kycMessageDiv.style.color = 'red';
      return;
    }
    
    try {
      await registerKYC(fullName, emailOrPhone, bankId);
    } catch (err) {
      kycMessageDiv.textContent = 'Error: ' + err.message;
      kycMessageDiv.style.color = 'red';
    }
  });
}

async function handleEncryptedTransaction(encryptedData) {
  // Validate encrypted data format
  if (!encryptedData.encrypted_payload || !encryptedData.encrypted_aes_key || !encryptedData.iv) {
    throw new Error('Invalid encrypted transaction format. Missing required fields.');
  }
  
  if (!encryptedData.sender_ecdh_public_key) {
    throw new Error('Missing sender ECDH public key. Transaction may be from old format.');
  }
  
  // Step 1: Decrypt AES key using Receiver private key (ECDH)
  const { privateKey: ecdhPrivateKey } = await ensureECDHKeyPair();
  const aesKey = await decryptAESKeyWithPrivateKey(
    encryptedData.encrypted_aes_key,
    encryptedData.sender_ecdh_public_key, // Use ECDH public key, not ECDSA
    ecdhPrivateKey
  );
  
  await logEvent({
    actor: 'receiver',
    action: 'decrypt_aes_key',
    status: 'success',
    connectivity: 'offline',
    details: { message: 'AES key decrypted successfully' }
  });
  
  // Step 2: Decrypt payload using AES key
  const decryptedPayload = await decryptAES(
    aesKey,
    encryptedData.encrypted_payload,
    encryptedData.iv
  );
  const txn = JSON.parse(decryptedPayload);
  
  await logEvent({
    actor: 'receiver',
    action: 'decrypt_payload',
    txn_id: txn.txn_id,
    status: 'success',
    connectivity: 'offline',
    details: { message: 'Transaction payload decrypted' }
  });
  
  // Step 3: Recompute transaction hash
  const canonical = canonicalTransactionString(txn);
  const expectedHash = await sha256Hex(canonical);
  
  if (expectedHash !== txn.hash) {
    throw new Error('Transaction hash mismatch after decryption');
  }
  
  // Step 4: Verify Sender signature using Sender public key
  const senderPublicKey = await crypto.subtle.importKey(
    'jwk',
    txn.sender_public_key,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  
  const verified = await verifySignature(txn.hash, txn.signature, senderPublicKey);
  if (!verified) {
    await logEvent({
      actor: 'receiver',
      action: 'verify_signature',
      txn_id: txn.txn_id,
      status: 'error',
      connectivity: 'offline',
      details: { message: 'Signature verification failed' }
    });
    throw new Error('Signature verification failed');
  }
  
  await logEvent({
    actor: 'receiver',
    action: 'verify_signature',
    txn_id: txn.txn_id,
    status: 'success',
    connectivity: 'offline',
    details: { message: 'Signature verified successfully' }
  });
  
  // Step 5: Append to ledger
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

async function ensureIdentity() {
  await generateAndStoreKeys(false);
  const receiverId = userInfo ? userInfo.bank_id : (localStorage.getItem('receiver_id') || 'Not set');
  identityDiv.innerHTML = `
    <div><strong>Receiver ID:</strong> ${receiverId}</div>
    <div class="small muted">ECDSA P-256 keypair for signing; ECDH keypair for decryption.</div>
  `;
}

async function generateAndStoreKeys(force) {
  if (cachedKeyPair && !force) return cachedKeyPair;
  const stored = localStorage.getItem('receiver_keys');
  if (stored && !force) {
    const { privateJwk, publicJwk } = JSON.parse(stored);
    cachedKeyPair = await importKeyPair(privateJwk, publicJwk);
    cachedPublicJwk = publicJwk;
    await ensureECDHKeyPair();
    return cachedKeyPair;
  }
  
  const receiverId = localStorage.getItem('receiver_id') || crypto.randomUUID();
  localStorage.setItem('receiver_id', receiverId);
  
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  localStorage.setItem('receiver_keys', JSON.stringify({ privateJwk, publicJwk }));
  cachedKeyPair = keyPair;
  cachedPublicJwk = publicJwk;
  await ensureECDHKeyPair();
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

async function ensureECDHKeyPair() {
  if (cachedECDHKeyPair && cachedECDHPublicJwk) return cachedECDHKeyPair;
  const stored = localStorage.getItem('receiver_ecdh_keys');
  if (stored) {
    const keyData = JSON.parse(stored);
    const privateJwk = keyData.privateJwk;
    const publicJwk = keyData.publicJwk;
    
    // If public key is missing, regenerate keys
    if (!publicJwk) {
      console.warn('ECDH public key missing, regenerating...');
      const ecdhKeyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
      );
      const newPrivateJwk = await crypto.subtle.exportKey('jwk', ecdhKeyPair.privateKey);
      const newPublicJwk = await crypto.subtle.exportKey('jwk', ecdhKeyPair.publicKey);
      localStorage.setItem('receiver_ecdh_keys', JSON.stringify({ privateJwk: newPrivateJwk, publicJwk: newPublicJwk }));
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
  localStorage.setItem('receiver_ecdh_keys', JSON.stringify({ privateJwk, publicJwk }));
  cachedECDHKeyPair = { privateKey: ecdhKeyPair.privateKey };
  cachedECDHPublicJwk = publicJwk;
  return cachedECDHKeyPair;
}

async function loadBankPublicKey() {
  const stored = localStorage.getItem('bank_public_key');
  if (stored) {
    try {
      bankPublicKeyJwk = JSON.parse(stored);
      bankKeyTextarea.value = stored;
      bankKeyStatus.textContent = '✓ Bank public key loaded';
      bankKeyStatus.style.color = 'green';
    } catch (e) {
      // Invalid stored key
    }
  }
}

function canonicalTransactionString(txn) {
  const ordered = {
    txn_id: txn.txn_id,
    from_id: txn.from_id,
    to_id: txn.to_id,
    amount: Number(txn.amount),
    timestamp: txn.timestamp,
    prev_hash: txn.prev_hash ?? '',
    wallet_id: txn.wallet_id ?? ''
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

async function exportEncryptedLedger() {
  if (!bankPublicKeyJwk) {
    alert('Please import bank public key first');
    return;
  }
  
  const db = await openDb();
  const tx = db.transaction(LEDGER_STORE, 'readonly');
  const store = tx.objectStore(LEDGER_STORE);
  const rows = await getAllLedger(store);
  if (!rows.length) {
    alert('Ledger is empty');
    return;
  }
  
  try {
    // Step 1: Compute SHA-256 hash of ledger
    const ledgerJson = JSON.stringify(rows);
    const ledgerHash = await sha256Hex(ledgerJson);
    
    // Step 2: Sign ledger hash using Receiver private key (ECDSA)
    const { privateKey } = await generateAndStoreKeys(false);
    const signature = await signHash(ledgerHash, privateKey);
    
    // Create signed payload
    const signedPayload = {
      ledger: rows,
      hash: ledgerHash,
      signature: signature,
      receiver_public_key: cachedPublicJwk
    };
    
    await logEvent({
      actor: 'receiver',
      action: 'sign_ledger',
      status: 'success',
      connectivity: 'offline',
      details: { message: 'Ledger signed successfully' }
    });
    
    // Step 3: Encrypt signed ledger using AES-256-GCM
    const aesKey = await generateAESKey();
    const { encrypted: encryptedPayload, iv } = await encryptAES(aesKey, signedPayload);
    
    // Step 4: Encrypt AES key using Bank public key (ECDH)
    const { privateKey: ecdhPrivateKey } = await ensureECDHKeyPair();
    const encryptedAESKey = await encryptAESKeyWithPublicKey(
      aesKey,
      bankPublicKeyJwk,
      ecdhPrivateKey
    );
    
    // Step 5: Export encrypted ledger file
    // Ensure ECDH public key is available
    if (!cachedECDHPublicJwk) {
      await ensureECDHKeyPair();
      if (!cachedECDHPublicJwk) {
        throw new Error('ECDH public key not available for export');
      }
    }
    
    const encryptedLedger = {
      encrypted_payload: encryptedPayload,
      encrypted_aes_key: encryptedAESKey,
      iv: iv,
      receiver_public_key: cachedECDHPublicJwk // ECDH public key for key exchange (Bank needs this!)
    };
    
    downloadJSON(`encrypted-ledger-${Date.now()}.json`, encryptedLedger);
    
    await logEvent({
      actor: 'receiver',
      action: 'export_encrypted_ledger',
      status: 'success',
      connectivity: 'offline',
      details: { message: 'Ledger encrypted and exported successfully' }
    });
  } catch (err) {
    alert('Error exporting ledger: ' + err.message);
    await logEvent({
      actor: 'receiver',
      action: 'export_encrypted_ledger',
      status: 'error',
      connectivity: 'offline',
      details: { message: err.message }
    });
  }
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

// Crypto functions moved to crypto-utils.js

// KYC Functions
async function registerKYC(fullName, emailOrPhone, bankId) {
  if (!cachedPublicJwk) {
    await generateAndStoreKeys(false);
  }
  
  const response = await fetch(`${BANK_API_URL}/kyc/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: fullName,
      email_or_phone: emailOrPhone,
      role: 'receiver',
      bank_id: bankId,
      public_key_jwk: cachedPublicJwk
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'KYC registration failed');
  }
  
  const result = await response.json();
  userInfo = {
    user_id: result.user_id,
    full_name: fullName,
    email_or_phone: emailOrPhone,
    bank_id: bankId,
    kyc_status: result.kyc_status
  };
  localStorage.setItem('receiver_user_info', JSON.stringify(userInfo));
  
  kycMessageDiv.textContent = result.message;
  kycMessageDiv.style.color = 'green';
  await renderKYCStatus();
  await ensureIdentity();
  await logEvent({
    actor: 'receiver',
    action: 'kyc_register',
    status: 'success',
    connectivity: 'online',
    details: { user_id: result.user_id, kyc_status: result.kyc_status }
  });
}

async function loadUserInfo() {
  const stored = localStorage.getItem('receiver_user_info');
  if (stored) {
    userInfo = JSON.parse(stored);
    // Check KYC status from bank
    if (userInfo.user_id) {
      try {
        const response = await fetch(`${BANK_API_URL}/kyc/users/${userInfo.user_id}`);
        if (response.ok) {
          const updated = await response.json();
          userInfo.kyc_status = updated.kyc_status;
          localStorage.setItem('receiver_user_info', JSON.stringify(userInfo));
        }
      } catch (e) {
        console.warn('Failed to check KYC status:', e);
      }
    }
  }
}

async function renderKYCStatus() {
  if (userInfo) {
    kycStatusDiv.innerHTML = `
      <div><strong>User ID:</strong> ${userInfo.user_id}</div>
      <div><strong>Name:</strong> ${userInfo.full_name}</div>
      <div><strong>Bank ID:</strong> ${userInfo.bank_id}</div>
      <div><strong>KYC Status:</strong> <span style="color: ${userInfo.kyc_status === 'approved' ? 'green' : 'orange'}">${userInfo.kyc_status}</span></div>
    `;
    kycForm.style.display = 'none';
  } else {
    kycStatusDiv.innerHTML = '<p class="muted small">Not registered. Please register for KYC.</p>';
    kycForm.style.display = 'block';
  }
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

