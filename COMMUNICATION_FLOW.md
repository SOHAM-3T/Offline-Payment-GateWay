# Communication Flow & Encryption Explained

## 🔐 How Sender and Receiver Communicate

### Overview
The communication happens **offline** via **QR code or file transfer**. All encryption/decryption happens **automatically behind the scenes** - users never see it!

---

## 📋 Complete Transaction Flow

### **Phase 1: Initial Setup (One-Time)**

#### Step 1: Receiver Shares Connection Code
```
Receiver Device:
1. Generates ECDH keypair (for encryption)
2. Generates ECDSA keypair (for signing)
3. Shows "Connection Code" (which is actually the ECDH public key in JSON format)
4. User copies this code
```

**What User Sees:** "Connection Code" button → Copy code

**What Actually Happens:**
- Receiver generates cryptographic keys
- ECDH public key is displayed as JSON
- This is the "connection code" users see

#### Step 2: Sender Connects to Receiver
```
Sender Device:
1. User pastes receiver's connection code
2. System validates it's a valid ECDH public key
3. Stores it locally for future use
```

**What User Sees:** Paste code → "Connected successfully!"

**What Actually Happens:**
- Code is parsed as JSON
- Validated as ECDH P-256 public key
- Stored in browser localStorage
- Ready to encrypt transactions

---

### **Phase 2: Creating a Payment (Sender Side)**

When user clicks "Pay Now", here's what happens **behind the scenes**:

#### Step 1: Create Transaction Data
```javascript
// User enters: Receiver ID = "MERCHANT123", Amount = 100.00
const txnCore = {
  txn_id: "uuid-1234-5678",
  from_id: "SENDER001",      // Sender's bank ID
  to_id: "MERCHANT123",      // Receiver's bank ID
  amount: 100.00,
  timestamp: "2024-01-15T10:30:00Z",
  prev_hash: "previous_hash",
  wallet_id: "wallet-uuid"   // For escrow tracking
};
```

#### Step 2: Compute Hash & Sign (ECDSA)
```javascript
// 1. Create canonical string (ordered fields)
const canonical = JSON.stringify({
  txn_id, from_id, to_id, amount, timestamp, prev_hash, wallet_id
});

// 2. Compute SHA-256 hash
const hash = SHA256(canonical);  // "a1b2c3d4..."

// 3. Sign hash with Sender's ECDSA private key
const signature = ECDSA_Sign(hash, sender_private_key);
```

**What Happens:**
- Transaction is hashed (SHA-256)
- Hash is signed with sender's private key
- Creates tamper-proof, non-repudiable transaction

#### Step 3: Encrypt Transaction (AES-256-GCM)
```javascript
// 1. Generate random AES-256 key
const aesKey = generateRandomAESKey();

// 2. Encrypt signed transaction with AES
const signedPayload = {
  ...txnCore,
  hash: hash,
  signature: signature,
  sender_public_key: sender_ecdsa_public_key
};

const { encrypted, iv } = AES_GCM_Encrypt(aesKey, signedPayload);
// Result: Base64 encoded encrypted data + IV
```

**What Happens:**
- Random AES-256 key generated
- Transaction + signature encrypted with AES-GCM
- IV (Initialization Vector) generated for security

#### Step 4: Encrypt AES Key (ECDH)
```javascript
// Encrypt the AES key using Receiver's public key
// This uses ECDH key exchange

// 1. Derive shared secret
const sharedSecret = ECDH_Derive(
  sender_ecdh_private_key,
  receiver_ecdh_public_key
);

// 2. Derive wrapping key from shared secret (HKDF)
const wrappingKey = HKDF(sharedSecret);

// 3. Encrypt AES key with wrapping key
const encryptedAESKey = AES_GCM_Encrypt(wrappingKey, aesKey);
```

**What Happens:**
- ECDH key exchange creates shared secret
- Shared secret used to encrypt the AES key
- Only receiver can decrypt (has matching private key)

#### Step 5: Package & Display QR Code
```javascript
const encryptedTransaction = {
  encrypted_payload: "...",           // Encrypted transaction
  encrypted_aes_key: "...",           // Encrypted AES key
  iv: "...",                           // IV for AES encryption
  sender_public_key: {...},           // ECDSA public key (for signature verification)
  sender_ecdh_public_key: {...}       // ECDH public key (for key exchange)
};

// Convert to JSON string
const qrData = JSON.stringify(encryptedTransaction);

// Generate QR code
QRCode.generate(qrData);
```

**What User Sees:** QR code appears in modal

**What Actually Happens:**
- All encrypted data packaged into JSON
- JSON converted to QR code
- Ready for transfer

---

### **Phase 3: Receiving Payment (Receiver Side)**

When receiver imports the file/QR code:

#### Step 1: Parse Encrypted Data
```javascript
// User imports file or scans QR code
const encryptedData = JSON.parse(fileContent);
// Contains: encrypted_payload, encrypted_aes_key, iv, sender keys
```

#### Step 2: Decrypt AES Key (ECDH)
```javascript
// 1. Derive shared secret using ECDH
const sharedSecret = ECDH_Derive(
  receiver_ecdh_private_key,      // Receiver's private key
  encryptedData.sender_ecdh_public_key  // Sender's public key
);

// 2. Derive wrapping key
const wrappingKey = HKDF(sharedSecret);

// 3. Decrypt AES key
const aesKey = AES_GCM_Decrypt(wrappingKey, encryptedData.encrypted_aes_key);
```

**What Happens:**
- ECDH key exchange (same as sender, but reverse)
- Shared secret derived
- AES key decrypted

#### Step 3: Decrypt Transaction (AES-256-GCM)
```javascript
// Decrypt the transaction payload
const decryptedPayload = AES_GCM_Decrypt(
  aesKey,
  encryptedData.encrypted_payload,
  encryptedData.iv
);

const txn = JSON.parse(decryptedPayload);
// Now we have: txn_id, from_id, to_id, amount, hash, signature, etc.
```

**What Happens:**
- Transaction decrypted with AES key
- Original transaction data recovered

#### Step 4: Verify Hash Integrity
```javascript
// Recompute hash from decrypted transaction
const canonical = JSON.stringify({
  txn_id: txn.txn_id,
  from_id: txn.from_id,
  to_id: txn.to_id,
  amount: txn.amount,
  timestamp: txn.timestamp,
  prev_hash: txn.prev_hash,
  wallet_id: txn.wallet_id
});

const expectedHash = SHA256(canonical);

// Verify hash matches
if (expectedHash !== txn.hash) {
  throw new Error("Transaction tampered!");
}
```

**What Happens:**
- Hash recomputed from decrypted data
- Compared with stored hash
- Detects any tampering

#### Step 5: Verify Signature (ECDSA)
```javascript
// Import sender's ECDSA public key
const senderPublicKey = importKey(txn.sender_public_key);

// Verify signature
const isValid = ECDSA_Verify(
  txn.hash,              // The hash
  txn.signature,          // The signature
  senderPublicKey         // Sender's public key
);

if (!isValid) {
  throw new Error("Signature invalid!");
}
```

**What Happens:**
- Sender's signature verified
- Confirms transaction came from sender
- Non-repudiation guaranteed

#### Step 6: Add to Ledger
```javascript
// Compute ledger entry hash (hash chain)
const prevHash = ledger.length > 0 ? ledger[ledger.length-1].hash : "GENESIS";
const ledgerHash = SHA256(prevHash + txn.hash);

// Add to ledger
const entry = {
  ledger_index: ledger.length,
  transaction: txn,
  hash: ledgerHash,
  status: "verified"
};

ledger.push(entry);
```

**What Happens:**
- Transaction added to hash-chained ledger
- Each entry linked to previous (tamper-evident)
- Status marked as "verified"

**What User Sees:** "✅ Payment received: ₹100.00"

---

## 🔒 Security Layers (All Automatic)

### Layer 1: Digital Signature (ECDSA)
- **Purpose:** Proves transaction came from sender
- **How:** Sender signs hash with private key
- **Verification:** Receiver verifies with sender's public key
- **Result:** Non-repudiation (sender can't deny sending)

### Layer 2: Symmetric Encryption (AES-256-GCM)
- **Purpose:** Encrypts transaction data
- **How:** Random AES key encrypts transaction
- **Security:** 256-bit key, authenticated encryption
- **Result:** Data confidentiality

### Layer 3: Asymmetric Key Exchange (ECDH)
- **Purpose:** Securely share AES key
- **How:** ECDH key exchange encrypts AES key
- **Security:** Only receiver can decrypt (has private key)
- **Result:** Secure key distribution

### Layer 4: Hash Chain
- **Purpose:** Detect tampering
- **How:** Each ledger entry hashes previous entry
- **Security:** Changing any entry breaks the chain
- **Result:** Tamper-evident ledger

---

## 📊 Visual Flow Diagram

```
SENDER DEVICE                    RECEIVER DEVICE
=============                    ===============

[User clicks "Pay Now"]
        |
        v
[Create Transaction]
  - txn_id, from_id, to_id, amount
        |
        v
[Compute Hash] (SHA-256)
        |
        v
[Sign Hash] (ECDSA)
  - Uses sender's private key
        |
        v
[Generate AES Key] (Random)
        |
        v
[Encrypt Transaction] (AES-256-GCM)
  - Transaction + signature encrypted
        |
        v
[Encrypt AES Key] (ECDH)
  - Uses receiver's public key
  - Only receiver can decrypt
        |
        v
[Package & QR Code]
  {
    encrypted_payload: "...",
    encrypted_aes_key: "...",
    iv: "...",
    sender_public_key: {...},
    sender_ecdh_public_key: {...}
  }
        |
        | (QR Code / File Transfer)
        |
        v
                            [Import File/QR]
                                    |
                                    v
                            [Decrypt AES Key] (ECDH)
                              - Uses receiver's private key
                              - Derives shared secret
                                    |
                                    v
                            [Decrypt Transaction] (AES-256-GCM)
                              - Recovers original transaction
                                    |
                                    v
                            [Verify Hash]
                              - Recomputes hash
                              - Checks for tampering
                                    |
                                    v
                            [Verify Signature] (ECDSA)
                              - Verifies sender's signature
                              - Confirms authenticity
                                    |
                                    v
                            [Add to Ledger]
                              - Hash-chained entry
                              - Tamper-evident
                                    |
                                    v
                            [Show Success] ✅
```

---

## 🎯 Key Points

### ✅ What Users See:
1. **Sender:** Enter amount → Click "Pay Now" → QR code appears
2. **Receiver:** Import file → "Payment received!"

### ✅ What Happens Behind the Scenes:
1. **Encryption:** Transaction encrypted with AES-256-GCM
2. **Key Exchange:** AES key encrypted with ECDH
3. **Signing:** Transaction signed with ECDSA
4. **Verification:** Hash and signature verified automatically
5. **Ledger:** Hash-chained, tamper-evident storage

### ✅ Security Guarantees:
- **Confidentiality:** Only receiver can decrypt
- **Integrity:** Hash verification detects tampering
- **Authentication:** Signature proves sender identity
- **Non-repudiation:** Sender can't deny sending
- **Tamper-evidence:** Hash chain detects ledger changes

---

## 🔑 Cryptographic Algorithms Used

1. **SHA-256:** Hashing (integrity)
2. **ECDSA P-256:** Digital signatures (authentication)
3. **AES-256-GCM:** Symmetric encryption (confidentiality)
4. **ECDH P-256:** Key exchange (secure key sharing)
5. **HKDF:** Key derivation (from shared secret)

All of these are **bank-grade** cryptographic standards!

---

## 💡 Why This Design?

1. **Offline Capable:** No internet needed for payment transfer
2. **Secure:** Multiple layers of encryption
3. **Tamper-Proof:** Hash chains detect any changes
4. **Non-Repudiable:** Signatures prove origin
5. **User-Friendly:** All complexity hidden from users

The encryption/decryption happens **completely automatically** - users never see keys, hashes, or signatures. They just see a clean payment interface! 🎉

