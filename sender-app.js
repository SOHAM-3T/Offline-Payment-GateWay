import {
  generateAESKey,
  encryptAES,
  encryptAESKeyWithPublicKey,
  sha256Hex,
  signHash
} from './sender/src/crypto-utils.js';

const BANK_API_URL_KEY = 'bank_api_url';
let userInfo = null;
let walletInfo = null;
let receiverPublicKeyJwk = null;
let cachedKeyPair = null;
let cachedPublicJwk = null;
let cachedECDHKeyPair = null;
let cachedECDHPublicJwk = null;
let transactions = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadUserData();
  await loadKeys();
  await loadReceiverPublicKey();
  await loadTransactions();
  setupEventHandlers();
  updateBalance();
  renderTransactions();
  await checkReceiverKey();

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
  const stored = localStorage.getItem('sender_user_info');
  if (stored) {
    userInfo = JSON.parse(stored);
    await refreshWalletInfo();
  }
}

async function refreshWalletInfo() {
  if (!userInfo || !userInfo.wallet_id) return;

  try {
    const response = await fetch(`${getBankApiUrl()}/wallets/${userInfo.wallet_id}`);
    if (response.ok) {
      const wallet = await response.json();
      walletInfo = wallet;
      updateBalance();
    } else {
      console.error('Wallet fetch failed:', response.status, response.statusText);
      try {
        const txt = await response.text();
        console.error('Response:', txt);
      } catch (err) { /* ignore read error */ }
    }
  } catch (e) {
    console.error('Failed to refresh wallet:', e);
  }
}

async function loadKeys() {
  const stored = localStorage.getItem('sender_keys');
  const ecdhStored = localStorage.getItem('sender_ecdh_keys');

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

async function loadReceiverPublicKey() {
  const stored = localStorage.getItem('receiver_public_key');
  if (stored) {
    try {
      // Try parsing as JSON string first
      receiverPublicKeyJwk = JSON.parse(stored);
      // If it's already an object, use it directly
      if (typeof receiverPublicKeyJwk === 'string') {
        receiverPublicKeyJwk = JSON.parse(receiverPublicKeyJwk);
      }
    } catch (e) {
      // If parsing fails, try using stored value directly
      try {
        receiverPublicKeyJwk = JSON.parse(stored);
      } catch (e2) {
        console.error('Failed to load receiver public key:', e2);
      }
    }
  }
}

function setupEventHandlers() {
  document.getElementById('payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await createPayment();
  });

  document.getElementById('close-qr').addEventListener('click', () => {
    document.getElementById('qr-modal').classList.add('hidden');
  });

  document.getElementById('download-qr-btn').addEventListener('click', () => {
    downloadTransactionFile();
  });

  // Close modal on overlay click
  document.getElementById('qr-modal').addEventListener('click', (e) => {
    if (e.target.id === 'qr-modal') {
      document.getElementById('qr-modal').classList.add('hidden');
    }
  });

  document.getElementById('save-receiver-key-btn').addEventListener('click', async () => {
    await saveReceiverKey();
  });
}

async function saveReceiverKey() {
  const keyText = document.getElementById('receiver-key-input').value.trim();
  if (!keyText) {
    showStatus('receiver-key-status', 'Please enter receiver connection code', 'error');
    return;
  }

  try {
    // Try parsing as JSON (full key) or as connection code
    let keyJwk;
    try {
      keyJwk = JSON.parse(keyText);
    } catch {
      // If not JSON, try to decode from base64 or use as-is
      // For now, assume it's JSON string that needs parsing
      throw new Error('Invalid connection code format');
    }

    // Validate it's a valid ECDH public key
    const importedKey = await crypto.subtle.importKey(
      'jwk',
      keyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    if (keyJwk.kty !== 'EC' || keyJwk.crv !== 'P-256') {
      throw new Error('Invalid connection code');
    }

    receiverPublicKeyJwk = keyJwk;
    localStorage.setItem('receiver_public_key', JSON.stringify(keyJwk));
    showStatus('receiver-key-status', '✓ Connected successfully!', 'success');

    // Hide config card after successful connection
    setTimeout(() => {
      document.getElementById('config-card').classList.add('hidden');
    }, 2000);
  } catch (err) {
    showStatus('receiver-key-status', '✗ Invalid connection code. Please check and try again.', 'error');
  }
}

// Check if receiver key is set on load
async function checkReceiverKey() {
  if (!receiverPublicKeyJwk) {
    document.getElementById('config-card').classList.remove('hidden');
  } else {
    document.getElementById('config-card').classList.add('hidden');
  }
}

function showStatus(elementId, text, type) {
  const element = document.getElementById(elementId);
  element.textContent = text;
  element.style.color = type === 'success' ? '#155724' : '#721c24';
}

async function createPayment() {
  if (!receiverPublicKeyJwk) {
    showMessage('Please configure receiver public key first', 'error');
    return;
  }

  const receiverId = document.getElementById('receiver-id').value.trim();
  const amount = parseFloat(document.getElementById('amount').value);

  if (!receiverId || !amount || amount <= 0) {
    showMessage('Please enter valid receiver ID and amount', 'error');
    return;
  }

  if (!walletInfo || walletInfo.current_balance < amount) {
    showMessage(`Insufficient balance. Available: ₹${walletInfo?.current_balance || 0}`, 'error');
    return;
  }

  const btn = document.getElementById('create-payment-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const encryptedTxn = await createEncryptedSignedTransaction({
      toId: receiverId,
      amount: amount,
      walletId: walletInfo.wallet_id
    });

    // Update local balance
    walletInfo.current_balance -= amount;
    walletInfo.used_amount = (walletInfo.used_amount || 0) + amount;
    updateBalance();

    // Store transaction
    const txn = {
      id: encryptedTxn.txn_id || crypto.randomUUID(),
      receiverId: receiverId,
      amount: amount,
      timestamp: new Date().toISOString(),
      status: 'pending',
      data: encryptedTxn
    };
    transactions.unshift(txn);
    saveTransactions();
    renderTransactions();

    // Store encrypted transaction for download
    lastEncryptedTxn = encryptedTxn;

    // Show success message
    showMessage('Payment created successfully!', 'success');

    // Show QR code (but don't block if it fails)
    showQRCode(encryptedTxn);

    // Clear form
    document.getElementById('payment-form').reset();

  } catch (err) {
    showMessage('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Payment';
  }
}

async function createEncryptedSignedTransaction({ toId, amount, walletId }) {
  const deviceId = userInfo.bank_id;
  const { privateKey } = cachedKeyPair;
  const publicJwk = cachedPublicJwk;
  const { privateKey: ecdhPrivateKey } = cachedECDHKeyPair;

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

  const canonical = canonicalTransactionString(txnCore);
  const hashHex = await sha256Hex(canonical);
  const signature = await signHash(hashHex, privateKey);

  const signedPayload = {
    ...txnCore,
    hash: hashHex,
    signature,
    sender_public_key: publicJwk
  };

  const aesKey = await generateAESKey();
  const { encrypted: encryptedPayload, iv } = await encryptAES(aesKey, signedPayload);
  const encryptedAESKey = await encryptAESKeyWithPublicKey(
    aesKey,
    receiverPublicKeyJwk,
    ecdhPrivateKey
  );

  const encryptedTxn = {
    encrypted_payload: encryptedPayload,
    encrypted_aes_key: encryptedAESKey,
    iv: iv,
    sender_public_key: publicJwk,
    sender_ecdh_public_key: cachedECDHPublicJwk,
    txn_id: txnCore.txn_id
  };

  localStorage.setItem('sender_last_txn_hash', hashHex);
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

function showQRCode(encryptedTxn) {
  const qrModal = document.getElementById('qr-modal');
  const qrDiv = document.getElementById('qrcode');
  const qrError = document.getElementById('qr-error');

  // Store for download
  lastEncryptedTxn = encryptedTxn;

  // Show modal immediately
  qrModal.classList.remove('hidden');
  qrError.style.display = 'none';

  // Check data size first
  const qrData = JSON.stringify(encryptedTxn);
  const dataSize = qrData.length;
  console.log('Transaction data size:', dataSize, 'characters');

  // QR codes have practical limits - encrypted data is usually too large
  // Most QR codes max out around 2000-3000 characters
  // Level L 40 allows ~2953 bytes.
  if (dataSize > 2900) {
    // Data too large - show download option immediately (no empty space!)
    qrDiv.innerHTML = `
      <div style="padding: 40px; text-align: center;">
        <div style="font-size: 64px; margin-bottom: 15px;">📄</div>
        <div style="font-size: 20px; font-weight: 600; color: #333; margin-bottom: 10px;">Payment File Ready</div>
        <div style="color: #666; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
          Your encrypted payment data (${dataSize} characters) is too large for QR code.<br/>
          <strong>Click "Download as File" below</strong> to share with receiver.
        </div>
      </div>
    `;
    return;
  }

  // Show loading state
  qrDiv.innerHTML = '<div style="padding: 40px; text-align: center; color: #666;"><div style="font-size: 48px; margin-bottom: 10px;">⏳</div><div>Generating QR code...</div></div>';

  // Function to generate QR code
  const generateQR = () => {
    // Check if QRCode library is available
    if (typeof QRCode === 'undefined') {
      qrDiv.innerHTML = `
        <div style="padding: 40px; text-align: center;">
          <div style="font-size: 64px; margin-bottom: 15px;">📥</div>
          <div style="font-size: 20px; font-weight: 600; color: #333; margin-bottom: 10px;">Download Payment File</div>
          <div style="color: #666; font-size: 14px; line-height: 1.6;">
            QR code library not available.<br/>
            <strong>Click "Download as File"</strong> to share payment.
          </div>
        </div>
      `;
      return;
    }

    // Clear loading and create canvas
    qrDiv.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    qrDiv.appendChild(canvas);

    // Generate QR code
    QRCode.toCanvas(canvas, qrData, {
      width: 280,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      },
      errorCorrectionLevel: 'L'
    }, (error) => {
      if (error) {
        console.error('QR Code error:', error);
        qrDiv.innerHTML = `
          <div style="padding: 40px; text-align: center;">
            <div style="font-size: 64px; margin-bottom: 15px;">📄</div>
            <div style="font-size: 20px; font-weight: 600; color: #333; margin-bottom: 10px;">Use File Download</div>
            <div style="color: #666; font-size: 14px; line-height: 1.6;">
              Unable to generate QR code.<br/>
              <strong>Click "Download as File"</strong> below.
            </div>
          </div>
        `;
      } else {
        console.log('✅ QR Code generated successfully!');
        canvas.style.maxWidth = '100%';
        canvas.style.height = 'auto';
      }
    });
  };

  // Try to generate immediately
  if (typeof QRCode !== 'undefined') {
    generateQR();
  } else {
    // Wait a bit for library to load
    let attempts = 0;
    const checkLibrary = () => {
      if (typeof QRCode !== 'undefined') {
        generateQR();
      } else if (attempts < 10) {
        attempts++;
        setTimeout(checkLibrary, 500);
      } else {
        // Final attempt failed
        generateQR();
      }
    };
    checkLibrary();
  }
}

function updateBalance() {
  // Fallback to locally stored amount if server fetch hasn't succeeded yet
  const balance = walletInfo?.current_balance ?? userInfo?.wallet_amount ?? 0;
  document.getElementById('balance-display').textContent = `₹${Number(balance).toFixed(2)}`;
}

function showMessage(text, type) {
  const msgDiv = document.getElementById('payment-message');
  msgDiv.textContent = text;
  msgDiv.className = `message ${type}`;
  msgDiv.classList.remove('hidden');
  setTimeout(() => {
    msgDiv.classList.add('hidden');
  }, 5000);
}

function loadTransactions() {
  const stored = localStorage.getItem('sender_transactions');
  if (stored) {
    transactions = JSON.parse(stored);
  }
}

function saveTransactions() {
  localStorage.setItem('sender_transactions', JSON.stringify(transactions));
}

function downloadTransactionFile() {
  if (!lastEncryptedTxn) {
    // Try to get from most recent transaction
    if (transactions.length > 0 && transactions[0].data) {
      lastEncryptedTxn = transactions[0].data;
    } else {
      showMessage('No transaction to download. Please create a payment first.', 'error');
      return;
    }
  }

  try {
    const fileName = `payment-${Date.now()}.json`;
    const blob = new Blob([JSON.stringify(lastEncryptedTxn, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Show success message
    const msgDiv = document.getElementById('payment-message');
    msgDiv.textContent = '✅ Payment file downloaded! Share this file with the receiver.';
    msgDiv.className = 'message success';
    msgDiv.classList.remove('hidden');
    setTimeout(() => {
      msgDiv.classList.add('hidden');
    }, 5000);
  } catch (err) {
    showMessage('Error downloading file: ' + err.message, 'error');
  }
}

let lastEncryptedTxn = null;

function renderTransactions() {
  const listDiv = document.getElementById('transactions-list');
  if (transactions.length === 0) {
    listDiv.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <div style="font-size: 48px; margin-bottom: 10px; opacity: 0.3;">📱</div>
        <p style="color: #999;">No transactions yet</p>
        <p style="color: #ccc; font-size: 12px; margin-top: 5px;">Your payment history will appear here</p>
      </div>
    `;
    return;
  }

  listDiv.innerHTML = transactions.slice(0, 10).map(txn => `
    <div class="transaction-item">
      <div class="transaction-icon">💸</div>
      <div class="transaction-details">
        <div class="transaction-name">${txn.receiverId}</div>
        <div class="transaction-time">${new Date(txn.timestamp).toLocaleString()}</div>
      </div>
      <div class="transaction-amount">-₹${txn.amount.toFixed(2)}</div>
    </div>
  `).join('');
}

