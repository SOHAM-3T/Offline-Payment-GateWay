import {
  decryptAES,
  decryptAESKeyWithPrivateKey,
  sha256Hex,
  verifySignature,
  generateAESKey,
  encryptAES,
  encryptAESKeyWithPublicKey,
  signHash
} from './receiver/src/crypto-utils.js';

const BANK_API_URL_KEY = 'bank_api_url';
let userInfo = null;
let cachedKeyPair = null;
let cachedPublicJwk = null;
let cachedECDHKeyPair = null;
let cachedECDHPublicJwk = null;
let bankPublicKeyJwk = null;
let ledger = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadUserData();
  await loadKeys();
  await loadBankPublicKey();
  await loadLedger();
  setupEventHandlers();
  renderLedger();
  updateTotal();
  
  // Check if user is registered
  if (!userInfo) {
    alert('Please register first');
    window.location.href = 'register.html';
    return;
  }
});

function getBankApiUrl() {
  return localStorage.getItem(BANK_API_URL_KEY) || 'http://localhost:4000';
}

async function loadUserData() {
  const stored = localStorage.getItem('receiver_user_info');
  if (stored) {
    userInfo = JSON.parse(stored);
  }
}

async function loadKeys() {
  const stored = localStorage.getItem('receiver_keys');
  const ecdhStored = localStorage.getItem('receiver_ecdh_keys');
  
  if (stored && ecdhStored) {
    const { privateJwk, publicJwk } = JSON.parse(stored);
    const ecdhData = JSON.parse(ecdhStored);
    
    cachedKeyPair = await importKeyPair(privateJwk, publicJwk);
    cachedPublicJwk = publicJwk;
    
    const ecdhPrivateKey = await crypto.subtle.importKey(
      'jwk',
      ecdhData.privateJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    cachedECDHKeyPair = { privateKey: ecdhPrivateKey };
    cachedECDHPublicJwk = ecdhData.publicJwk;
  } else {
    // Generate keys if not found (shouldn't happen if registered properly)
    console.warn('Keys not found, generating new ones...');
    await generateKeys();
  }
}

async function generateKeys() {
  // Generate ECDSA keypair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  
  // Generate ECDH keypair
  const ecdhKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const ecdhPrivateJwk = await crypto.subtle.exportKey('jwk', ecdhKeyPair.privateKey);
  const ecdhPublicJwk = await crypto.subtle.exportKey('jwk', ecdhKeyPair.publicKey);
  
  localStorage.setItem('receiver_keys', JSON.stringify({ privateJwk, publicJwk }));
  localStorage.setItem('receiver_ecdh_keys', JSON.stringify({ privateJwk: ecdhPrivateJwk, publicJwk: ecdhPublicJwk }));
  
  cachedKeyPair = await importKeyPair(privateJwk, publicJwk);
  cachedPublicJwk = publicJwk;
  cachedECDHKeyPair = { privateKey: ecdhKeyPair.privateKey };
  cachedECDHPublicJwk = ecdhPublicJwk;
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

async function loadBankPublicKey() {
  const stored = localStorage.getItem('bank_public_key');
  if (stored) {
    try {
      bankPublicKeyJwk = JSON.parse(stored);
    } catch (e) {
      console.error('Failed to load bank public key:', e);
    }
  } else {
    // Try to fetch from bank
    try {
      const response = await fetch(`${getBankApiUrl()}/bank-public-key`);
      if (response.ok) {
        const data = await response.json();
        bankPublicKeyJwk = data.public_key;
        localStorage.setItem('bank_public_key', JSON.stringify(bankPublicKeyJwk));
      }
    } catch (e) {
      console.warn('Could not fetch bank public key:', e);
    }
  }
}

function setupEventHandlers() {
  document.getElementById('file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const encryptedData = JSON.parse(text);
      await handleEncryptedTransaction(encryptedData);
    } catch (err) {
      showMessage('Error processing file: ' + err.message, 'error');
    } finally {
      e.target.value = '';
    }
  });
  
  document.getElementById('sync-btn').addEventListener('click', async () => {
    await syncToBank();
  });
  
  document.getElementById('copy-key-btn').addEventListener('click', () => {
    copyPublicKey();
  });
  
  document.getElementById('show-config-btn').addEventListener('click', () => {
    document.getElementById('config-card').classList.remove('hidden');
  });
  
  document.getElementById('hide-config-btn').addEventListener('click', () => {
    document.getElementById('config-card').classList.add('hidden');
  });
  
  // Display public key on load
  displayPublicKey();
}

function displayPublicKey() {
  if (cachedECDHPublicJwk) {
    const keyText = JSON.stringify(cachedECDHPublicJwk);
    document.getElementById('public-key-display').value = keyText;
  }
}

function copyPublicKey() {
  const textarea = document.getElementById('public-key-display');
  textarea.select();
  document.execCommand('copy');
  const statusDiv = document.getElementById('copy-status');
  statusDiv.textContent = '✓ Connection code copied! Share this with senders.';
  statusDiv.style.color = '#155724';
  setTimeout(() => {
    statusDiv.textContent = '';
  }, 3000);
}

async function handleEncryptedTransaction(encryptedData) {
  if (!encryptedData.encrypted_payload || !encryptedData.encrypted_aes_key || !encryptedData.iv) {
    throw new Error('Invalid transaction format');
  }
  
  if (!encryptedData.sender_ecdh_public_key) {
    throw new Error('Missing sender ECDH public key');
  }
  
  const { privateKey: ecdhPrivateKey } = cachedECDHKeyPair;
  const aesKey = await decryptAESKeyWithPrivateKey(
    encryptedData.encrypted_aes_key,
    encryptedData.sender_ecdh_public_key,
    ecdhPrivateKey
  );
  
  const decryptedPayload = await decryptAES(
    aesKey,
    encryptedData.encrypted_payload,
    encryptedData.iv
  );
  const txn = JSON.parse(decryptedPayload);
  
  const canonical = canonicalTransactionString(txn);
  const expectedHash = await sha256Hex(canonical);
  
  if (expectedHash !== txn.hash) {
    throw new Error('Transaction hash mismatch');
  }
  
  const senderPublicKey = await crypto.subtle.importKey(
    'jwk',
    txn.sender_public_key,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  
  const verified = await verifySignature(txn.hash, txn.signature, senderPublicKey);
  if (!verified) {
    throw new Error('Signature verification failed');
  }
  
  // Add to ledger
  const entry = {
    ledger_index: ledger.length,
    transaction: txn,
    hash: await sha256Hex((ledger.length > 0 ? ledger[ledger.length - 1].hash : 'GENESIS') + txn.hash),
    status: 'verified',
    received_at: new Date().toISOString()
  };
  
  ledger.push(entry);
  saveLedger();
  renderLedger();
  updateTotal();
  
  // Show success animation
  const listDiv = document.getElementById('ledger-list');
  listDiv.classList.add('success-animation');
  setTimeout(() => listDiv.classList.remove('success-animation'), 600);
  
  showMessage(`✅ Payment received: ₹${txn.amount}`, 'success');
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

async function syncToBank() {
  if (!bankPublicKeyJwk) {
    showMessage('Bank public key not configured', 'error');
    return;
  }
  
  if (ledger.length === 0) {
    showMessage('No transactions to sync', 'error');
    return;
  }
  
  const btn = document.getElementById('sync-btn');
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  
  try {
    // Sign ledger
    const ledgerJson = JSON.stringify(ledger.map(e => ({
      ledger_index: e.ledger_index,
      transaction: e.transaction,
      hash: e.hash,
      status: e.status
    })));
    const ledgerHash = await sha256Hex(ledgerJson);
    const { privateKey } = cachedKeyPair;
    const signature = await signHash(ledgerHash, privateKey);
    
    const signedPayload = {
      ledger: ledger.map(e => ({
        ledger_index: e.ledger_index,
        transaction: e.transaction,
        hash: e.hash,
        status: e.status
      })),
      hash: ledgerHash,
      signature: signature,
      receiver_public_key: cachedPublicJwk
    };
    
    // Encrypt ledger
    const aesKey = await generateAESKey();
    const { encrypted: encryptedPayload, iv } = await encryptAES(aesKey, signedPayload);
    const { privateKey: ecdhPrivateKey } = cachedECDHKeyPair;
    const encryptedAESKey = await encryptAESKeyWithPublicKey(
      aesKey,
      bankPublicKeyJwk,
      ecdhPrivateKey
    );
    
    const encryptedLedger = {
      encrypted_payload: encryptedPayload,
      encrypted_aes_key: encryptedAESKey,
      iv: iv,
      receiver_public_key: cachedECDHPublicJwk
    };
    
    // Send to bank
    const response = await fetch(`${getBankApiUrl()}/settle-ledger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encryptedLedger)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Settlement failed');
    }
    
    const result = await response.json();
    showMessage(`Successfully synced ${result.settled_transactions.length} transactions to bank`, 'success');
    
  } catch (err) {
    showMessage('Sync error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync to Bank';
  }
}

function showMessage(text, type) {
  const msgDiv = document.getElementById('receive-message');
  msgDiv.textContent = text;
  msgDiv.className = `message ${type}`;
  msgDiv.classList.remove('hidden');
  setTimeout(() => {
    msgDiv.classList.add('hidden');
  }, 5000);
}

function loadLedger() {
  const stored = localStorage.getItem('receiver_ledger');
  if (stored) {
    ledger = JSON.parse(stored);
  }
}

function saveLedger() {
  localStorage.setItem('receiver_ledger', JSON.stringify(ledger));
}

function renderLedger() {
  const listDiv = document.getElementById('ledger-list');
  if (ledger.length === 0) {
    listDiv.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <div style="font-size: 48px; margin-bottom: 10px; opacity: 0.3;">💰</div>
        <p style="color: #999;">No payments received yet</p>
        <p style="color: #ccc; font-size: 12px; margin-top: 5px;">Received payments will appear here</p>
      </div>
    `;
    return;
  }
  
  listDiv.innerHTML = ledger.map(entry => {
    const txn = entry.transaction;
    return `
      <div class="ledger-item">
        <div class="ledger-icon">💵</div>
        <div class="ledger-details">
          <div class="ledger-name">${txn.from_id}</div>
          <div class="ledger-time">${new Date(txn.timestamp).toLocaleString()}</div>
        </div>
        <div class="ledger-amount">+₹${txn.amount.toFixed(2)}</div>
      </div>
    `;
  }).join('');
}

function updateTotal() {
  const total = ledger.reduce((sum, entry) => sum + entry.transaction.amount, 0);
  document.getElementById('total-display').textContent = `₹${total.toFixed(2)}`;
}

