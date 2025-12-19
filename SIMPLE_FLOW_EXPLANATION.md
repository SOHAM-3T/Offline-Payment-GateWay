# Simple Flow Explanation - How It Works

## 🎯 Quick Answer

**Yes, encryption/decryption happens automatically behind the scenes!** Users never see it.

---

## 📱 Step-by-Step: What User Sees vs What Actually Happens

### **SETUP (One-Time)**

#### Receiver Side:
**User Sees:**
- Clicks "Show Connection Code"
- Copies a code
- Shares with sender

**Actually Happens:**
- Receiver generates cryptographic keys (ECDH + ECDSA)
- ECDH public key is shown as "Connection Code"
- This key allows sender to encrypt messages only receiver can decrypt

#### Sender Side:
**User Sees:**
- Pastes connection code
- Sees "Connected successfully!"

**Actually Happens:**
- Code validated as valid ECDH public key
- Stored locally for encrypting future transactions
- Ready to send encrypted payments

---

### **MAKING A PAYMENT**

#### What User Does:
1. Enters receiver ID: "MERCHANT123"
2. Enters amount: "100.00"
3. Clicks "Pay Now"
4. QR code appears

#### What Happens Behind the Scenes (Automatic):

```
Step 1: Create Transaction
├─ txn_id: "abc-123"
├─ from_id: "SENDER001"
├─ to_id: "MERCHANT123"
├─ amount: 100.00
└─ timestamp: "2024-01-15..."

Step 2: Hash Transaction (SHA-256)
└─ hash = "a1b2c3d4e5f6..." (unique fingerprint)

Step 3: Sign Hash (ECDSA)
└─ signature = "xyz..." (proves sender created it)

Step 4: Encrypt Transaction (AES-256-GCM)
├─ Generate random AES key
├─ Encrypt: transaction + hash + signature
└─ Result: encrypted_payload + iv

Step 5: Encrypt AES Key (ECDH)
├─ Use receiver's public key
├─ Encrypt the AES key
└─ Result: encrypted_aes_key

Step 6: Package Everything
└─ {
      encrypted_payload: "...",
      encrypted_aes_key: "...",
      iv: "...",
      sender_public_key: {...},
      sender_ecdh_public_key: {...}
    }

Step 7: Generate QR Code
└─ QR code contains encrypted JSON
```

**User only sees:** QR code appears ✅

---

### **RECEIVING A PAYMENT**

#### What User Does:
1. Clicks "Choose Payment File"
2. Selects the file (or scans QR code)
3. Sees "✅ Payment received: ₹100.00"

#### What Happens Behind the Scenes (Automatic):

```
Step 1: Parse Encrypted Data
└─ Read JSON from file/QR code

Step 2: Decrypt AES Key (ECDH)
├─ Use receiver's private key
├─ Derive shared secret with sender's public key
└─ Decrypt: encrypted_aes_key → aes_key

Step 3: Decrypt Transaction (AES-256-GCM)
├─ Use decrypted AES key
└─ Decrypt: encrypted_payload → transaction data

Step 4: Verify Hash
├─ Recompute hash from decrypted data
├─ Compare with stored hash
└─ If mismatch → ERROR (tampered!)

Step 5: Verify Signature (ECDSA)
├─ Use sender's public key
├─ Verify signature matches hash
└─ If invalid → ERROR (not from sender!)

Step 6: Add to Ledger
├─ Compute ledger hash (hash chain)
├─ Add to append-only ledger
└─ Mark as "verified"
```

**User only sees:** "Payment received!" ✅

---

## 🔐 Encryption Flow (Visual)

```
SENDER                                    RECEIVER
======                                    =======

Transaction Data
    |
    v
[Hash] SHA-256
    |
    v
[Sign] ECDSA (Private Key)
    |
    v
[Encrypt] AES-256-GCM
    |     (Random AES Key)
    |           |
    |           v
    |     [Encrypt AES Key] ECDH
    |     (Receiver's Public Key)
    |           |
    v           v
[Package] → QR Code/File
    |
    | (Transfer)
    |
    v
                    [Import]
                          |
                          v
                    [Decrypt AES Key] ECDH
                    (Receiver's Private Key)
                          |
                          v
                    [Decrypt Transaction] AES-256-GCM
                          |
                          v
                    [Verify Hash]
                          |
                          v
                    [Verify Signature] ECDSA
                          |
                          v
                    [Add to Ledger] ✅
```

---

## 🎯 Key Questions Answered

### Q1: How do they communicate?
**A:** Via **QR code or file transfer** (offline). No internet needed!

### Q2: Is encryption happening?
**A:** **YES!** Three layers:
1. **AES-256-GCM:** Encrypts transaction data
2. **ECDH:** Encrypts the AES key
3. **ECDSA:** Signs the transaction

### Q3: Is it automatic?
**A:** **YES!** All encryption/decryption happens automatically. Users never see:
- Keys
- Hashes
- Signatures
- Encryption algorithms

### Q4: What if someone intercepts?
**A:** They can't decrypt because:
- AES key is encrypted with receiver's public key
- Only receiver's private key can decrypt it
- Even if they get the file, it's useless without receiver's key

### Q5: How is it verified?
**A:** Automatic verification:
- Hash ensures data wasn't tampered
- Signature proves it came from sender
- Both checked automatically before accepting payment

---

## 💡 Real-World Analogy

Think of it like a **secure package delivery**:

1. **Sender:**
   - Puts item (transaction) in box
   - Locks box with combination lock (AES encryption)
   - Puts combination in safe (ECDH encryption)
   - Only receiver can open safe (has private key)
   - Signs delivery slip (ECDSA signature)

2. **Receiver:**
   - Receives package
   - Opens safe with their key (decrypt AES key)
   - Opens box with combination (decrypt transaction)
   - Verifies signature on delivery slip
   - Confirms item matches description (hash check)

All of this happens **automatically** - users just see "Send" and "Receive"!

---

## 🔍 Code Locations

If you want to see the actual encryption code:

- **Encryption Functions:** `sender/src/crypto-utils.js`
- **Sender Encryption:** `sender-app.js` → `createEncryptedSignedTransaction()`
- **Receiver Decryption:** `receiver-app.js` → `handleEncryptedTransaction()`

But remember - **users never see this code!** It all runs automatically in the background. 🎉

