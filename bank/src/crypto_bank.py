"""
Bank-side cryptographic utilities for decryption and signature verification.
Handles AES-256-GCM decryption and ECDH key exchange.
"""
import base64
import hashlib
import json
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization


def sha256(data: str) -> str:
    """Compute SHA-256 hash of a string."""
    return hashlib.sha256(data.encode('utf-8')).hexdigest()


def decrypt_aes_key_with_private_key(
    encrypted_aes_key_b64: str,
    receiver_public_key_jwk: dict,
    bank_private_key: ec.EllipticCurvePrivateKey
) -> bytes:
    """
    Decrypt AES key using bank's private key (ECDH).
    Receiver encrypts AES key with Bank's public key, Bank decrypts with its private key.
    Matches frontend decryptAESKeyWithPrivateKey logic.
    
    Args:
        encrypted_aes_key_b64: Base64 encoded encrypted AES key (IV + encrypted key)
        receiver_public_key_jwk: Receiver's ECDH public key in JWK format
        bank_private_key: Bank's ECDH private key
    """
    try:
        # Decode encrypted AES key
        encrypted_buffer = base64.b64decode(encrypted_aes_key_b64)
        if len(encrypted_buffer) < 12:
            raise ValueError("Encrypted AES key too short (missing IV)")
        iv = encrypted_buffer[:12]
        encrypted_key_data = encrypted_buffer[12:]
        
        # Validate receiver public key format
        if 'x' not in receiver_public_key_jwk or 'y' not in receiver_public_key_jwk:
            raise ValueError("Invalid receiver public key format: missing x or y coordinates")
        if receiver_public_key_jwk.get('kty') != 'EC' or receiver_public_key_jwk.get('crv') != 'P-256':
            raise ValueError("Receiver public key must be ECDH P-256, not ECDSA")
        
        # Import receiver's public key for ECDH
        # Convert JWK to point format for cryptography library
        x_bytes = base64.urlsafe_b64decode(receiver_public_key_jwk['x'] + '==')
        y_bytes = base64.urlsafe_b64decode(receiver_public_key_jwk['y'] + '==')
        
        # Reconstruct public key point
        public_numbers = ec.EllipticCurvePublicNumbers(
            int.from_bytes(x_bytes, 'big'),
            int.from_bytes(y_bytes, 'big'),
            ec.SECP256R1()
        )
        receiver_public_key = public_numbers.public_key(default_backend())
        
        # Derive shared secret using ECDH
        shared_secret = bank_private_key.exchange(ec.ECDH(), receiver_public_key)
        
        # Derive AES key from shared secret using HKDF
        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=32,  # 256 bits
            salt=None,
            info=b'aes-key-wrapping',
            backend=default_backend()
        )
        derived_key = hkdf.derive(shared_secret)
        
        # Decrypt AES key
        aesgcm = AESGCM(derived_key)
        aes_key_raw = aesgcm.decrypt(iv, encrypted_key_data, None)
        
        return aes_key_raw
    except Exception as e:
        # Provide more detailed error message
        error_msg = str(e)
        if 'decrypt' in error_msg.lower() or 'authentication' in error_msg.lower():
            raise ValueError(f"Decryption failed: Key mismatch. Receiver's ECDH public key doesn't match the key used for encryption. Error: {error_msg}")
        raise ValueError(f"Failed to decrypt AES key: {error_msg}")


def decrypt_aes(encrypted_b64: str, iv_b64: str, aes_key: bytes) -> str:
    """
    Decrypt data using AES-256-GCM.
    """
    encrypted = base64.b64decode(encrypted_b64)
    iv = base64.b64decode(iv_b64)
    
    aesgcm = AESGCM(aes_key)
    decrypted = aesgcm.decrypt(iv, encrypted, None)
    
    return decrypted.decode('utf-8')


def verify_signature_ecdsa(hash_hex: str, signature_b64: str, public_key_jwk: dict) -> bool:
    """
    Verify ECDSA signature using public key in JWK format.
    """
    try:
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
        import struct
        
        # Import public key from JWK
        x_bytes = base64.urlsafe_b64decode(public_key_jwk['x'] + '==')
        y_bytes = base64.urlsafe_b64decode(public_key_jwk['y'] + '==')
        
        public_numbers = ec.EllipticCurvePublicNumbers(
            int.from_bytes(x_bytes, 'big'),
            int.from_bytes(y_bytes, 'big'),
            ec.SECP256R1()
        )
        public_key = public_numbers.public_key(default_backend())
        
        # Decode signature (base64 -> DER format)
        signature_bytes = base64.b64decode(signature_b64)
        
        # Web Crypto API produces signatures in raw format (r||s, 64 bytes)
        # Convert to DER format for cryptography library
        if len(signature_bytes) == 64:
            r = int.from_bytes(signature_bytes[:32], 'big')
            s = int.from_bytes(signature_bytes[32:], 'big')
            # Encode as DER
            from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
            der_signature = encode_dss_signature(r, s)
        else:
            der_signature = signature_bytes
        
        # Verify signature
        hash_bytes = bytes.fromhex(hash_hex)
        public_key.verify(
            der_signature,
            hash_bytes,
            ec.ECDSA(hashes.SHA256())
        )
        return True
    except Exception as e:
        print(f"Signature verification error: {e}")
        return False



