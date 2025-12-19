# Debugging Tips for Receiver Processing

## Common Issues and Solutions

### Issue 1: "Missing sender ECDH public key"
**Cause:** Transaction file was created with old sender code that didn't include ECDH public key.

**Solution:**
1. Regenerate sender keys: In Sender app, click "Regenerate keypair"
2. Create a new transaction
3. Export the new encrypted transaction file
4. Try importing again in Receiver

### Issue 2: "Invalid encrypted transaction format"
**Cause:** File is not in the correct encrypted format, or missing required fields.

**Check:**
- File should have: `encrypted_payload`, `encrypted_aes_key`, `iv`, `sender_public_key`, `sender_ecdh_public_key`
- Verify file is valid JSON

### Issue 3: Decryption errors
**Possible causes:**
1. Receiver ECDH keypair was regenerated after sender created transaction
2. Wrong receiver public key was imported into sender
3. Keys don't match

**Solution:**
1. Export receiver public key again
2. Import into sender again
3. Create new transaction

### Issue 4: Signature verification fails
**Possible causes:**
1. Transaction was tampered with
2. Sender keys were regenerated
3. Hash computation mismatch

**Check:**
- Browser console for detailed error
- Verify transaction hash matches
- Check if sender regenerated keys

## Debugging Steps

1. **Check Browser Console**
   - Open Developer Tools (F12)
   - Look for error messages
   - Check Network tab if making API calls

2. **Check Receiver Logs**
   - Click "Refresh logs" in Receiver app
   - Look for error entries
   - Check which step failed (decrypt_aes_key, decrypt_payload, verify_signature, etc.)

3. **Verify Key Configuration**
   - Sender: Check "Receiver Public Key" is saved (green checkmark)
   - Receiver: Check "Bank Public Key" is saved (green checkmark)
   - Verify keys haven't been regenerated

4. **Test with Fresh Keys**
   - Regenerate all keys
   - Re-export and import public keys
   - Create new transaction

## Expected File Format

Encrypted transaction file should look like:
```json
{
  "encrypted_payload": "base64...",
  "encrypted_aes_key": "base64...",
  "iv": "base64...",
  "sender_public_key": {
    "kty": "EC",
    "crv": "P-256",
    ...
  },
  "sender_ecdh_public_key": {
    "kty": "EC",
    "crv": "P-256",
    ...
  }
}
```

## Verification Checklist

- [ ] Sender has Receiver public key saved
- [ ] Receiver has Bank public key saved
- [ ] Transaction file has all required fields
- [ ] Transaction file includes `sender_ecdh_public_key`
- [ ] Keys haven't been regenerated since transaction creation
- [ ] Browser console shows no errors
- [ ] Receiver logs show detailed error messages

