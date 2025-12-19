# Encryption Setup Guide

## Overview
The system now implements mandatory encryption and digital signatures for all inter-actor communication, following bank-grade security requirements.

## Key Exchange Setup

### 1. Get Bank Public Key
First, start the bank service and retrieve its public key:

```bash
cd bank
python run.py
```

In another terminal:
```bash
curl http://localhost:4000/bank-public-key
```

Save the `public_key` JSON object from the response.

### 2. Get Receiver Public Key
1. Open Receiver app in browser (`http://localhost:5174` or your receiver port)
2. Click "Export Public Key (for Sender)"
3. Save the downloaded `receiver-public-key.json` file

### 3. Configure Sender
1. Open Sender app (`http://localhost:5173` or your sender port)
2. Paste the Receiver public key JSON into the "Receiver Public Key" textarea
3. Click "Save Receiver Public Key"
4. You should see "✓ Receiver public key saved"

### 4. Configure Receiver
1. In Receiver app, paste the Bank public key JSON into the "Bank Public Key" textarea
2. Click "Save Bank Public Key"
3. You should see "✓ Bank public key saved"

## Usage Flow

### Creating Encrypted Transactions (Sender)
1. Ensure Receiver public key is configured
2. Enter Receiver ID and Amount
3. Click "Create + Encrypt + Sign"
4. Click "Export encrypted transaction (JSON)"
5. Transfer the file to Receiver (via USB, email, etc.)

### Processing Transactions (Receiver)
1. Import the encrypted transaction file
2. Receiver will:
   - Decrypt AES key using its private key
   - Decrypt transaction payload
   - Verify Sender signature
   - Append to ledger
3. Transaction appears in ledger view

### Exporting Ledger to Bank (Receiver)
1. Ensure Bank public key is configured
2. Click "Export encrypted ledger JSON"
3. Transfer the file to Bank (via API, file upload, etc.)

### Settling Ledger (Bank)
The bank accepts both encrypted and unencrypted ledgers:

**Encrypted Ledger:**
```bash
curl -X POST http://localhost:4000/settle-ledger \
  -H "Content-Type: application/json" \
  -d "@encrypted-ledger-1234567890.json"
```

**Unencrypted Ledger (backward compatible):**
```bash
curl -X POST http://localhost:4000/settle-ledger \
  -H "Content-Type: application/json" \
  -d "@receiver-ledger.json"
```

## Cryptographic Flow

### Sender → Receiver
1. Sender creates transaction JSON
2. Sender computes SHA-256 hash
3. Sender signs hash (ECDSA P-256)
4. Sender generates AES-256-GCM key
5. Sender encrypts signed payload (AES)
6. Sender encrypts AES key (ECDH with Receiver public key)
7. Export: `{encrypted_payload, encrypted_aes_key, iv, sender_public_key}`

### Receiver Processing
1. Receiver decrypts AES key (ECDH with Receiver private key)
2. Receiver decrypts payload (AES)
3. Receiver recomputes transaction hash
4. Receiver verifies Sender signature
5. Receiver appends to ledger

### Receiver → Bank
1. Receiver computes ledger hash
2. Receiver signs ledger hash (ECDSA)
3. Receiver encrypts signed ledger (AES-256-GCM)
4. Receiver encrypts AES key (ECDH with Bank public key)
5. Export: `{encrypted_payload, encrypted_aes_key, iv, receiver_public_key}`

### Bank Processing
1. Bank decrypts AES key (ECDH with Bank private key)
2. Bank decrypts ledger payload
3. Bank verifies Receiver signature
4. Bank verifies ledger hash chain
5. Bank verifies individual Sender signatures
6. Bank settles transactions

## Security Properties

- **Confidentiality**: All messages encrypted with AES-256-GCM
- **Integrity**: SHA-256 hashing + hash chains
- **Authentication**: ECDSA digital signatures
- **Non-repudiation**: Sender signatures verified using public keys
- **Tamper Detection**: Hash-chained ledger

## Key Storage

- **Sender**: 
  - ECDSA keypair (signing) - stored in localStorage
  - ECDH keypair (encryption) - stored in localStorage
  - Receiver public key - stored in localStorage

- **Receiver**: 
  - ECDSA keypair (signing) - stored in localStorage
  - ECDH keypair (decryption) - stored in localStorage
  - Bank public key - stored in localStorage

- **Bank**: 
  - ECDH keypair (decryption) - stored in `bank_keys.json`
  - Public key available via `/bank-public-key` endpoint

## Troubleshooting

### "Please import receiver public key first"
- Ensure Receiver public key is saved in Sender app
- Check that the JSON is valid JWK format

### "Please import bank public key first"
- Ensure Bank public key is saved in Receiver app
- Verify bank service is running and accessible

### Decryption errors
- Verify keys are correctly imported
- Check that keys haven't been regenerated
- Ensure encrypted file format matches expected structure

### Signature verification failures
- Keys may have been regenerated - re-export and import public keys
- Verify transaction hasn't been tampered with
- Check that hash computation matches between sender/receiver/bank

