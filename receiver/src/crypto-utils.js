/**
 * Cryptographic utilities for receiver
 * Same as sender but with receiver-specific key management
 */

// Export all functions
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
 */
async function encryptAES(key, plaintext) {
  const data = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext);
  const dataBuffer = new TextEncoder().encode(data);
  
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
 * Encrypt AES key using bank's public key (ECDH)
 */
async function encryptAESKeyWithPublicKey(aesKey, bankPublicKeyJwk, receiverPrivateKey) {
  const bankPublicKey = await crypto.subtle.importKey(
    'jwk',
    bankPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: bankPublicKey },
    receiverPrivateKey,
    256
  );
  
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
  
  const aesKeyRaw = await crypto.subtle.exportKey('raw', aesKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    aesKeyRaw
  );
  
  return bufferToBase64(new Uint8Array([...iv, ...new Uint8Array(encryptedKey)]));
}

/**
 * Decrypt AES key using receiver's private key (ECDH)
 */
async function decryptAESKeyWithPrivateKey(encryptedAESKey, senderPublicKeyJwk, receiverPrivateKey) {
  const encryptedBuffer = base64ToBuffer(encryptedAESKey);
  const encryptedArray = new Uint8Array(encryptedBuffer);
  const iv = encryptedArray.slice(0, 12); // Uint8Array for IV (12 bytes)
  // Extract encrypted key data (everything after IV) as ArrayBuffer
  const encryptedKeyData = encryptedBuffer.slice(12);
  
  const senderPublicKey = await crypto.subtle.importKey(
    'jwk',
    senderPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: senderPublicKey },
    receiverPrivateKey,
    256
  );
  
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
  // Ensure IV is Uint8Array and encryptedKeyData is ArrayBuffer
  try {
    const aesKeyRaw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      derivedKey,
      encryptedKeyData
    );
    
    return await crypto.subtle.importKey(
      'raw',
      aesKeyRaw,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    const errorMsg = error.message || error.toString() || 'Unknown error';
    console.error('Decryption error details:', {
      error: errorMsg,
      errorName: error.name,
      ivLength: iv.length,
      ivType: iv.constructor.name,
      encryptedDataLength: encryptedKeyData.byteLength,
      encryptedDataType: encryptedKeyData.constructor.name
    });
    
    // Provide helpful error message
    if (error.name === 'OperationError' || errorMsg.includes('decrypt') || errorMsg.includes('operation')) {
      throw new Error(
        'Failed to decrypt AES key: Key mismatch detected. ' +
        'The Receiver\'s ECDH keypair doesn\'t match the public key used by the Sender. ' +
        'SOLUTION: 1) In Receiver, click "Regenerate keypair" and export new public key. ' +
        '2) In Sender, import the new Receiver public key and regenerate keys. ' +
        '3) Create a new transaction in Sender. ' +
        '4) Import the new transaction in Receiver.'
      );
    }
    
    throw new Error(`Failed to decrypt AES key: ${errorMsg}. This may indicate a key mismatch or corrupted data.`);
  }
}

/**
 * Compute SHA-256 hash
 */
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hash);
}

/**
 * Sign hash using ECDSA
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
 * Verify signature
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

