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
    
    // Check wallet
    if (!walletInfo || walletInfo.status !== 'approved') {
      alert('Please request and get approval for an offline wallet first');
      return;
    }
    
    const toId = document.querySelector('#to-id').value.trim();
    const amount = Number(document.querySelector('#amount').value);
    if (!toId || !amount || Number.isNaN(amount) || amount <= 0) {
      alert('Receiver ID and valid amount are required');
      return;
    }
    
    // Check wallet balance
    if (walletInfo.current_balance < amount) {
      alert(`Insufficient wallet balance. Available: ${walletInfo.current_balance}, Required: ${amount}`);
      return;
    }
    
    try {
      const encryptedTxn = await createEncryptedSignedTransaction({ 
        toId, 
        amount,
        walletId: walletInfo.wallet_id 
      });
      lastEncryptedTxn = encryptedTxn;
      previewDiv.innerHTML = `<pre>${JSON.stringify(encryptedTxn, null, 2)}</pre>`;
      exportBtn.disabled = false;
      
      // Update local wallet balance (offline tracking)
      walletInfo.current_balance -= amount;
      walletInfo.used_amount = (walletInfo.used_amount || 0) + amount;
      await saveWalletInfo();
      await renderWalletStatus();
      
      await logEvent({
        actor: 'sender',
        action: 'create_encrypted_txn',
        txn_id: encryptedTxn.txn_id || 'pending',
        status: 'success',
        connectivity: 'offline',
        details: { 
          message: 'Transaction encrypted, signed and ready to export',
          wallet_id: walletInfo.wallet_id,
          amount: amount,
          remaining_balance: walletInfo.current_balance
        }
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

async function createEncryptedSignedTransaction({ toId, amount, walletId }) {
  const deviceId = userInfo ? userInfo.bank_id : localStorage.getItem('sender_device_id');
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
    prev_hash: prevHash,
    wallet_id: walletId || null
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
    prev_hash: txn.prev_hash ?? '',
    wallet_id: txn.wallet_id ?? ''
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
      role: 'sender',
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
  localStorage.setItem('sender_user_info', JSON.stringify(userInfo));
  
  kycMessageDiv.textContent = result.message;
  kycMessageDiv.style.color = 'green';
  await renderKYCStatus();
  await logEvent({
    actor: 'sender',
    action: 'kyc_register',
    status: 'success',
    connectivity: 'online',
    details: { user_id: result.user_id, kyc_status: result.kyc_status }
  });
}

async function loadUserInfo() {
  const stored = localStorage.getItem('sender_user_info');
  if (stored) {
    userInfo = JSON.parse(stored);
    // Check KYC status from bank
    if (userInfo.user_id) {
      try {
        const response = await fetch(`${BANK_API_URL}/kyc/users/${userInfo.user_id}`);
        if (response.ok) {
          const updated = await response.json();
          userInfo.kyc_status = updated.kyc_status;
          localStorage.setItem('sender_user_info', JSON.stringify(userInfo));
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
    kycForm.style.display = userInfo.kyc_status === 'approved' ? 'none' : 'block';
  } else {
    kycStatusDiv.innerHTML = '<p class="muted small">Not registered. Please register for KYC.</p>';
    kycForm.style.display = 'block';
  }
}

// Wallet Functions
async function requestWallet(limit) {
  if (!userInfo || !userInfo.user_id) {
    throw new Error('Please complete KYC registration first');
  }
  if (userInfo.kyc_status !== 'approved') {
    throw new Error('KYC must be approved before requesting wallet');
  }
  
  const response = await fetch(`${BANK_API_URL}/wallets/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userInfo.user_id,
      requested_limit: limit
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Wallet request failed');
  }
  
  const result = await response.json();
  walletInfo = {
    wallet_id: result.wallet_id,
    user_id: userInfo.user_id,
    status: result.status,
    approved_limit: 0,
    current_balance: 0
  };
  await saveWalletInfo();
  
  walletMessageDiv.textContent = result.message;
  walletMessageDiv.style.color = 'green';
  await renderWalletStatus();
  await logEvent({
    actor: 'sender',
    action: 'wallet_request',
    status: 'success',
    connectivity: 'online',
    details: { wallet_id: result.wallet_id, requested_limit: limit }
  });
}

async function loadWalletInfo() {
  const stored = localStorage.getItem('sender_wallet_info');
  if (stored) {
    walletInfo = JSON.parse(stored);
    // Refresh wallet balance from bank
    if (walletInfo && walletInfo.wallet_id) {
      try {
        await refreshWalletBalance();
      } catch (e) {
        console.warn('Failed to refresh wallet balance:', e);
      }
    }
  }
}

async function refreshWalletBalance() {
  if (!walletInfo || !walletInfo.wallet_id) return;
  
  try {
    const response = await fetch(`${BANK_API_URL}/wallets/${walletInfo.wallet_id}`);
    if (response.ok) {
      const updated = await response.json();
      walletInfo = {
        wallet_id: updated.wallet_id,
        user_id: updated.user_id,
        status: updated.status,
        approved_limit: updated.approved_limit,
        current_balance: updated.current_balance,
        used_amount: updated.used_amount,
        locked_amount: updated.locked_amount
      };
      await saveWalletInfo();
      await renderWalletStatus();
    }
  } catch (e) {
    console.warn('Failed to refresh wallet:', e);
  }
}

async function saveWalletInfo() {
  if (walletInfo) {
    localStorage.setItem('sender_wallet_info', JSON.stringify(walletInfo));
    const db = await openDb();
    const tx = db.transaction(WALLET_STORE, 'readwrite');
    const store = tx.objectStore(WALLET_STORE);
    await store.put(walletInfo);
    await tx.complete;
  }
}

async function renderWalletStatus() {
  if (walletInfo) {
    walletStatusDiv.innerHTML = `
      <div><strong>Wallet ID:</strong> ${walletInfo.wallet_id}</div>
      <div><strong>Status:</strong> <span style="color: ${walletInfo.status === 'approved' ? 'green' : 'orange'}">${walletInfo.status}</span></div>
      ${walletInfo.status === 'approved' ? `
        <div><strong>Approved Limit:</strong> ${walletInfo.approved_limit}</div>
        <div><strong>Current Balance:</strong> ${walletInfo.current_balance}</div>
        <div><strong>Used Amount:</strong> ${walletInfo.used_amount}</div>
      ` : ''}
    `;
    walletForm.style.display = walletInfo.status === 'approved' ? 'none' : 'block';
    
    if (walletInfo.status === 'approved') {
      walletBalanceDiv.innerHTML = `
        <div style="font-size: 1.2em; font-weight: bold; color: ${walletInfo.current_balance > 0 ? 'green' : 'red'}">
          Available Balance: ${walletInfo.current_balance}
        </div>
      `;
    } else {
      walletBalanceDiv.innerHTML = '';
    }
  } else {
    walletStatusDiv.innerHTML = '<p class="muted small">No wallet. Please request a wallet.</p>';
    walletForm.style.display = userInfo && userInfo.kyc_status === 'approved' ? 'block' : 'none';
    walletBalanceDiv.innerHTML = '';
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

