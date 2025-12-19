# Offline-Payment-Gateway

A secure, offline-to-online payment simulation system involving three actors: **Sender**, **Receiver**, and **Bank**. It demonstrates hash-chained ledgers, ECDSA signatures, AES-GCM encryption, and ECDH key exchange for secure offline payments.

---

## 📚 Table of Contents
1. [Project Overview](#project-overview)
2. [Quick Start](#quick-start)
3. [Architecture & Concepts](#architecture--concepts)
4. [Setup & Configuration](#setup--configuration)
5. [Implementation Details](#implementation-details)
6. [Testing & Debugging](#testing--debugging)
7. [Future Roadmap](#future-roadmap)

---

## <a id="project-overview"></a> 1. Project Overview

**Offline Payment Gateway** simulates a scenario where a Sender (Buyer) and Receiver (Merchant) exchange payments without an internet connection. The Receiver later syncs with a Bank for settlement validation.

### Key Features
- **Offline-First:** Sender and Receiver operate without active internet.
- **Secure:**
    - **Confidentiality:** AES-256-GCM encryption for all transactions.
    - **Integrity:** SHA-256 hash chains prevent ledger tampering.
    - **Authentication:** ECDSA P-256 signatures prove identity.
    - **Key Exchange:** ECDH P-256 for secure shared secrets.
- **Auditability:** Bank maintains a complete audit log of all settlements.

### Actors
- **Sender (Device 1):** Creates and signs transactions (offline). Usage: Vite + JS.
- **Receiver (Device 2):** Verifies signatures and maintains a local ledger (offline). Usage: Vite + JS.
- **Bank (Device 3):** Validates ledgers and settles funds (online). Usage: Python (FastAPI) + PostgreSQL.

---

## <a id="quick-start"></a> 2. Quick Start

### Prerequisites
- **Python 3.8+**
- **Node.js** (for frontend development server)
- **PostgreSQL** (running on port 5432)

### 🚀 5-Minute Setup

#### Step 1: Database Setup
```powershell
# Create database
createdb -U postgres payment_gateway

# Apply schema
psql -U postgres -d payment_gateway -f schema.sql
```

#### Step 2: Start Bank Server (Backend)
```powershell
cd bank
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/Mac:
# source venv/bin/activate

pip install -r requirements.txt
cp env.sample .env
# Edit .env to set your DATABASE_URL

python run.py
# Server running at http://localhost:4000
```

#### Step 3: Start Frontend Apps
**Terminal 1 (Sender):**
```powershell
cd sender
npm install
npm run dev
# Sender running at http://localhost:5173
```

**Terminal 2 (Receiver):**
```powershell
cd receiver
npm install
npm run dev
# Receiver running at http://localhost:5174
```

### 🏁 Quick Test Flow
1.  **Get Bank Key:** `curl http://localhost:4000/bank-public-key`
2.  **Configure Receiver (`http://localhost:5174`):**
    -   Import Bank Public Key.
    -   Export "Receiver Public Key" (save as JSON).
3.  **Configure Sender (`http://localhost:5173`):**
    -   Import "Receiver Public Key" (from previous step).
4.  **Create Transaction (Sender):**
    -   Enter Receiver ID & Amount -> "Create + Encrypt + Sign".
    -   Export encrypted JSON.
5.  **Process Transaction (Receiver):**
    -   Import encrypted JSON.
    -   Verify success message.
6.  **Settle (Receiver -> Bank):**
    -   Export "Encrypted Ledger".
    -   Send to Bank via API:
        ```powershell
        curl -X POST http://localhost:4000/settle-ledger -H "Content-Type: application/json" -d "@encrypted-ledger.json"
        ```

---

## <a id="architecture--concepts"></a> 3. Architecture & Concepts

### How It Works (Simplified)
The user sees a simple "Pay" and "Receive" flow, but complex cryptography happens in the background.

1.  **Sender** calculates a hash of the transaction and signs it (ECDSA).
2.  **Sender** encrypts the transaction with a random AES key.
3.  **Sender** encrypts the AES key using the Receiver's Public Key (ECDH).
4.  **Receiver** decrypts the AES key using their Private Key.
5.  **Receiver** decrypts the transaction and verifies the Sender's signature.
6.  **Receiver** adds the transaction to a **hash-chained ledger** (like a blockchain).
7.  **Bank** verifies the entire chain and signatures before moving money.

### Communication Flow
-   **Sender -> Receiver:** File Transfer or QR Code (Offline).
-   **Receiver -> Bank:** API over Internet (Online).

### Security Layers
1.  **Digital Signature (ECDSA):** Proves origin.
2.  **Symmetric Encryption (AES-GCM):** Protects data privacy.
3.  **Asymmetric Key Exchange (ECDH):** Securely shares encryption keys.
4.  **Hash Chain:** Ensures ledger immutability.

---

## <a id="setup--configuration"></a> 4. Setup & Configuration

### Detailed Database Setup
If the quick start failed, try these options for PostgreSQL:

**Option 1: Using psql**
```powershell
psql -U postgres -c "CREATE DATABASE payment_gateway;"
psql -U postgres -d payment_gateway -f schema.sql
```

**Option 2: Connection String**
Modify `bank/.env` with your credentials:
```
DATABASE_URL=postgresql://username:password@localhost:5432/payment_gateway
```

### Encryption Setup (Key Exchange)
The system relies on exchanging public keys **before** transactions can happen.

1.  **Bank Identity:**
    -   The Bank generates an ECDH keypair on startup (`bank/bank_keys.json`).
    -   Public key available at `/bank-public-key`.
2.  **Receiver Setup:**
    -   Generates keys on first load.
    -   Must import Bank's Public Key to encrypt ledgers for the Bank.
    -   Must export their Public Key for the Sender.
3.  **Sender Setup:**
    -   Generates keys on first load.
    -   Must import Receiver's Public Key to encrypt transactions for the Receiver.

---

## <a id="implementation-details"></a> 5. Implementation Details

### Tech Stack
-   **Frontend:** Vite, Vanilla JavaScript, Web Crypto API.
-   **Backend:** Python 3.9+, FastAPI, `cryptography` library.
-   **Database:** PostgreSQL/TimescaleDB.

### Cryptographic Algorithms
-   **Hashing:** SHA-256
-   **Signing:** ECDSA P-256
-   **Encryption:** AES-256-GCM
-   **Key Exchange:** ECDH P-256 with HKDF key derivation

### Data Structures

**Transaction JSON (Encrypted):**
```json
{
  "encrypted_payload": "base64...",
  "encrypted_aes_key": "base64...",
  "iv": "base64...",
  "sender_public_key": { "kty": "EC", ... },
  "sender_ecdh_public_key": { "kty": "EC", ... }
}
```

**Ledger Entry:**
```json
{
  "ledger_index": 0,
  "transaction": { ...decrypted_txn... },
  "hash": "sha256(prev_hash + txn_hash)",
  "status": "verified"
}
```

---

## <a id="testing--debugging"></a> 6. Testing & Debugging

### Common Issues

#### 1. "Missing sender ECDH public key"
**Cause:** Old transaction format created before ECDH implementation.
**Fix:**
1.  Go to Sender -> "Regenerate keypair".
2.  Import Receiver Public Key again.
3.  Create a NEW transaction.

#### 2. Decryption Fails
**Cause:** Key mismatch (e.g., Receiver regenerated keys after Sender imported the old public key).
**Fix:** Reshare keys.
1.  Receiver: Regenerate & Export Public Key.
2.  Sender: Import new Public Key.
3.  Sender: Create fresh transaction.

#### 3. Database Connection Error
**Cause:** Incorrect password or DB name in `.env`.
**Fix:**
-   Verify credentials with `psql -U <user> -d payment_gateway`.
-   Ensure PostgreSQL service is running (`Get-Service postgresql*`).

### Logging
-   **Frontend:** Check Browser Console (F12) and the in-app "Logs" tab.
-   **Backend:** Check the terminal running `python run.py`.
-   **Database:** Query the `audit_logs` table: `SELECT * FROM audit_logs ORDER BY created_at DESC;`

---

## <a id="future-roadmap"></a> 7. Future Roadmap

-   [ ] **Real-world Network Test:** Deploy Bank to cloud (e.g., Render/Heroku) and test with mobile devices on 4G.
-   [ ] **QR Code Scanning:** Integrate a JS library to scan QR codes directly in the browser instead of file upload.
-   [ ] **User Accounts:** Implement proper login/auth instead of purely local identity.
-   [ ] **P2P Sync:** Allow offline peer-to-peer sync between Senders (e.g., splitting a bill).
