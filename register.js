import {
  generateAESKey,
  encryptAES,
  encryptAESKeyWithPublicKey,
  sha256Hex,
  signHash
} from './sender/src/crypto-utils.js';

let selectedRole = null;
let cachedKeyPair = null;
let cachedPublicJwk = null;
let cachedECDHKeyPair = null;
let cachedECDHPublicJwk = null;
const BANK_API_URL_KEY = 'bank_api_url';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupRoleSelector();
  setupForm();
  loadBankApiUrl();
});

function setupRoleSelector() {
  const options = document.querySelectorAll('.role-option');
  options.forEach(option => {
    option.addEventListener('click', () => {
      options.forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');
      selectedRole = option.dataset.role;
      document.getElementById('registration-form').classList.remove('hidden');
      hideMessage();
    });
  });
}

function setupForm() {
  const form = document.getElementById('registration-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleRegistration();
  });
  
  // Save bank API URL on change
  document.getElementById('bank-api-url').addEventListener('change', (e) => {
    localStorage.setItem(BANK_API_URL_KEY, e.target.value);
  });
}

function loadBankApiUrl() {
  const stored = localStorage.getItem(BANK_API_URL_KEY);
  if (stored) {
    document.getElementById('bank-api-url').value = stored;
  }
}

function getBankApiUrl() {
  return document.getElementById('bank-api-url').value || 'http://localhost:4000';
}

function showMessage(text, type = 'info') {
  const messageDiv = document.getElementById('message');
  messageDiv.textContent = text;
  messageDiv.className = `message ${type}`;
  messageDiv.classList.remove('hidden');
}

function hideMessage() {
  document.getElementById('message').classList.add('hidden');
}

async function generateAndStoreKeys() {
  if (cachedKeyPair && cachedPublicJwk) return;
  
  // Generate ECDSA keypair for signing
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  
  // Generate ECDH keypair for encryption
  const ecdhKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const ecdhPrivateJwk = await crypto.subtle.exportKey('jwk', ecdhKeyPair.privateKey);
  const ecdhPublicJwk = await crypto.subtle.exportKey('jwk', ecdhKeyPair.publicKey);
  
  // Store keys
  const storageKey = selectedRole === 'sender' ? 'sender_keys' : 'receiver_keys';
  const storageEcdhKey = selectedRole === 'sender' ? 'sender_ecdh_keys' : 'receiver_ecdh_keys';
  
  localStorage.setItem(storageKey, JSON.stringify({ privateJwk, publicJwk }));
  localStorage.setItem(storageEcdhKey, JSON.stringify({ privateJwk: ecdhPrivateJwk, publicJwk: ecdhPublicJwk }));
  
  cachedKeyPair = keyPair;
  cachedPublicJwk = publicJwk;
  cachedECDHKeyPair = { privateKey: ecdhKeyPair.privateKey };
  cachedECDHPublicJwk = ecdhPublicJwk;
  
  return { keyPair, publicJwk };
}

async function handleRegistration() {
  if (!selectedRole) {
    showMessage('Please select a role (Sender or Receiver)', 'error');
    return;
  }
  
  const fullName = document.getElementById('full-name').value.trim();
  const emailOrPhone = document.getElementById('email-phone').value.trim();
  const bankId = document.getElementById('bank-id').value.trim();
  const walletAmount = parseFloat(document.getElementById('wallet-amount').value);
  
  if (!fullName || !emailOrPhone || !bankId || !walletAmount || walletAmount <= 0) {
    showMessage('Please fill all fields with valid values', 'error');
    return;
  }
  
  const registerBtn = document.getElementById('register-btn');
  registerBtn.disabled = true;
  registerBtn.textContent = 'Registering...';
  
  try {
    // Generate keys
    await generateAndStoreKeys();
    
    // Register KYC
    const bankApiUrl = getBankApiUrl();
    const kycResponse = await fetch(`${bankApiUrl}/kyc/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName,
        email_or_phone: emailOrPhone,
        role: selectedRole,
        bank_id: bankId,
        public_key_jwk: cachedPublicJwk
      })
    });
    
    if (!kycResponse.ok) {
      const error = await kycResponse.json();
      throw new Error(error.detail || 'KYC registration failed');
    }
    
    const kycResult = await kycResponse.json();
    const userId = kycResult.user_id;
    
    showMessage('KYC registered! Waiting for approval...', 'info');
    
    // Auto-approve KYC (for simulation - in production this would be manual)
    // In real scenario, bank admin would approve
    try {
      await fetch(`${bankApiUrl}/kyc/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          kyc_status: 'approved',
          notes: 'Auto-approved for simulation'
        })
      });
    } catch (e) {
      console.warn('Auto-approval failed (may need manual approval):', e);
    }
    
    // Request wallet
    const walletResponse = await fetch(`${bankApiUrl}/wallets/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        requested_limit: walletAmount
      })
    });
    
    if (!walletResponse.ok) {
      const error = await walletResponse.json();
      throw new Error(error.detail || 'Wallet request failed');
    }
    
    const walletResult = await walletResponse.json();
    const walletId = walletResult.wallet_id;
    
    // Auto-approve wallet (for simulation)
    try {
      await fetch(`${bankApiUrl}/wallets/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_id: walletId,
          approved_limit: walletAmount,
          status: 'approved',
          notes: 'Auto-approved for simulation'
        })
      });
    } catch (e) {
      console.warn('Auto-approval failed (may need manual approval):', e);
    }
    
    // Store user info
    const userInfo = {
      user_id: userId,
      full_name: fullName,
      email_or_phone: emailOrPhone,
      bank_id: bankId,
      kyc_status: 'approved',
      wallet_id: walletId,
      wallet_amount: walletAmount,
      role: selectedRole
    };
    
    const userInfoKey = selectedRole === 'sender' ? 'sender_user_info' : 'receiver_user_info';
    localStorage.setItem(userInfoKey, JSON.stringify(userInfo));
    localStorage.setItem(BANK_API_URL_KEY, bankApiUrl);
    
    showMessage('Registration successful! Redirecting...', 'success');
    
    // Redirect to appropriate page
    setTimeout(() => {
      if (selectedRole === 'sender') {
        window.location.href = 'sender.html';
      } else {
        window.location.href = 'receiver.html';
      }
    }, 1500);
    
  } catch (err) {
    showMessage('Error: ' + err.message, 'error');
    registerBtn.disabled = false;
    registerBtn.textContent = 'Register & Create Wallet';
  }
}

