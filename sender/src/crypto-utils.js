/**
 * Cryptographic utilities for encryption and signing
 * Implements AES-256-GCM for symmetric encryption and ECDH for key exchange
 */

// Export all functions for use in main.js
export {
  generateAESKey,
  encryptAES,
  decryptAES,
  encryptAESKeyWithPublicKey,
  decryptAESKeyWithPrivateKey,
  sha256Hex,
  signHash,
  verifySignature
};

/**
 * Generate a random AES-256-GCM key
 */
async function generateAESKey() {
  return await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-256-GCM
 * @param {CryptoKey} key - AES key
 * @param {string} plaintext - Data to encrypt (will be JSON stringified if object)
 * @returns {Promise<{encrypted: string, iv: string}>} Base64 encoded encrypted data and IV
 */
async function encryptAES(key, plaintext) {
  const data = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext);
  const dataBuffer = new TextEncoder().encode(data);
  
  // Generate random IV (96 bits for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    dataBuffer
  );
  
  return {
    encrypted: bufferToBase64(new Uint8Array(encrypted)),
    iv: bufferToBase64(iv)
  };
}

/**
 * Decrypt data using AES-256-GCM
 * @param {CryptoKey} key - AES key
 * @param {string} encrypted - Base64 encoded encrypted data
 * @param {string} iv - Base64 encoded IV
 * @returns {Promise<string>} Decrypted plaintext
 */
async function decryptAES(key, encrypted, iv) {
  const encryptedBuffer = base64ToBuffer(encrypted);
  const ivBuffer = base64ToBuffer(iv);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    key,
    encryptedBuffer
  );
  
  return new TextDecoder().decode(decrypted);
}

/**
 * Encrypt AES key using receiver's public key (ECDH)
 * @param {CryptoKey} aesKey - AES key to encrypt
 * @param {Object} receiverPublicKeyJwk - Receiver's public key in JWK format
 * @param {CryptoKey} senderPrivateKey - Sender's private key for ECDH
 * @returns {Promise<string>} Base64 encoded encrypted AES key
 */
async function encryptAESKeyWithPublicKey(aesKey, receiverPublicKeyJwk, senderPrivateKey) {
  // Import receiver's public key for ECDH
  const receiverPublicKey = await crypto.subtle.importKey(
    'jwk',
    receiverPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  
  // Derive shared secret using ECDH
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPublicKey },
    senderPrivateKey,
    256
  );
  
  // Derive AES key from shared secret using HKDF
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('aes-key-wrapping')
    },
    await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      { name: 'HKDF' },
      false,
      ['deriveKey']
    ),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  // Export AES key as raw bytes
  const aesKeyRaw = await crypto.subtle.exportKey('raw', aesKey);
  
  // Encrypt AES key with derived key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    aesKeyRaw
  );
  
  // Return encrypted key + IV as base64
  return bufferToBase64(new Uint8Array([...iv, ...new Uint8Array(encryptedKey)]));
}

/**
 * Decrypt AES key using receiver's private key (ECDH)
 * @param {string} encryptedAESKey - Base64 encoded encrypted AES key
 * @param {Object} senderPublicKeyJwk - Sender's public key in JWK format
 * @param {CryptoKey} receiverPrivateKey - Receiver's private key for ECDH
 * @returns {Promise<CryptoKey>} Decrypted AES key
 */
async function decryptAESKeyWithPrivateKey(encryptedAESKey, senderPublicKeyJwk, receiverPrivateKey) {
  const encryptedBuffer = base64ToBuffer(encryptedAESKey);
  const iv = encryptedBuffer.slice(0, 12);
  const encryptedKeyData = encryptedBuffer.slice(12);
  
  // Import sender's public key for ECDH
  const senderPublicKey = await crypto.subtle.importKey(
    'jwk',
    senderPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  
  // Derive shared secret using ECDH
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: senderPublicKey },
    receiverPrivateKey,
    256
  );
  
  // Derive AES key from shared secret using HKDF
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('aes-key-wrapping')
    },
    await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      { name: 'HKDF' },
      false,
      ['deriveKey']
    ),
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  
  // Decrypt AES key
  const aesKeyRaw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    encryptedKeyData
  );
  
  // Import decrypted AES key
  return await crypto.subtle.importKey(
    'raw',
    aesKeyRaw,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Compute SHA-256 hash and return hex string
 */
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hash);
}

/**
 * Sign hash using ECDSA private key
 */
async function signHash(hashHex, privateKey) {
  const sigBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    hexToBuffer(hashHex)
  );
  return bufferToBase64(sigBuffer);
}

/**
 * Verify signature using ECDSA public key
 */
async function verifySignature(hashHex, signature, publicKey) {
  const sigBuffer = base64ToBuffer(signature);
  return await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    sigBuffer,
    hexToBuffer(hashHex)
  );
}

// Helper functions
function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

