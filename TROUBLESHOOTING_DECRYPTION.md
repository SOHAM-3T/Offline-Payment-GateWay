# Troubleshooting Decryption Errors

## Common Causes

### 1. Key Mismatch
**Symptom:** `OperationError` during AES key decryption

**Cause:** The Receiver's ECDH keypair doesn't match the one used when the Sender imported the Receiver's public key.

**Solution:**
1. **In Receiver app:**
   - Click "Regenerate keypair" to create new ECDH keys
   - Click "Export Public Key (for Sender)" to get new public key
   - Save the file

2. **In Sender app:**
   - Paste the NEW Receiver public key
   - Click "Save Receiver Public Key"
   - Create a NEW transaction
   - Export the new encrypted transaction file

3. **In Receiver app:**
   - Import the NEW encrypted transaction file

### 2. Wrong Public Key Used
**Symptom:** Decryption fails even with correct keys

**Check:**
- Sender must use Receiver's ECDH public key (not ECDSA)
- Receiver must use Sender's ECDH public key (not ECDSA)
- Verify keys are saved correctly (green checkmarks)

### 3. Transaction Created Before Key Update
**Symptom:** "Missing sender ECDH public key" error

**Solution:** Create a new transaction after updating keys

## Debugging Steps

1. **Check Browser Console (F12)**
   - Look for detailed error messages
   - Check the error details I added

2. **Verify Key Configuration**
   - Sender: Receiver public key saved? (green checkmark)
   - Receiver: Bank public key saved? (green checkmark)

3. **Check Transaction File**
   - Open the encrypted transaction JSON file
   - Verify it has `sender_ecdh_public_key` field
   - Verify it has `encrypted_aes_key`, `encrypted_payload`, `iv` fields

4. **Regenerate All Keys**
   - Receiver: Regenerate keypair → Export public key
   - Sender: Import new Receiver public key → Regenerate keypair → Create transaction
   - Receiver: Import new transaction

## Expected Flow

1. **Receiver generates ECDH keypair** (private + public)
2. **Receiver exports public key** → Sender imports it
3. **Sender generates ECDH keypair** (private + public)
4. **Sender encrypts AES key** using:
   - Receiver's ECDH public key (from step 2)
   - Sender's ECDH private key (from step 3)
5. **Receiver decrypts AES key** using:
   - Sender's ECDH public key (from transaction file)
   - Receiver's ECDH private key (from step 1)

If any step uses wrong keys, decryption will fail!

