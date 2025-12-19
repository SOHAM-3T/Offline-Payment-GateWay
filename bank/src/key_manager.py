"""
Bank key management for ECDH decryption.
Generates and stores bank's ECDH keypair.
"""
import os
import json
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend


def get_or_create_bank_keypair():
    """
    Get or create bank's ECDH keypair for decryption.
    Returns private key (EllipticCurvePrivateKey).
    """
    key_file = os.path.join(os.path.dirname(__file__), '..', 'bank_keys.json')
    
    if os.path.exists(key_file):
        with open(key_file, 'r') as f:
            key_data = json.load(f)
            private_key_pem = key_data['private_key']
            return serialization.load_pem_private_key(
                private_key_pem.encode(),
                password=None,
                backend=default_backend()
            )
    
    # Generate new keypair
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
    public_key = private_key.public_key()
    
    # Serialize keys
    private_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode()
    
    public_key_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    
    # Export public key as JWK for sharing with Receiver
    public_numbers = public_key.public_numbers()
    x_bytes = public_numbers.x.to_bytes(32, 'big')
    y_bytes = public_numbers.y.to_bytes(32, 'big')
    
    import base64
    public_key_jwk = {
        'kty': 'EC',
        'crv': 'P-256',
        'x': base64.urlsafe_b64encode(x_bytes).decode().rstrip('='),
        'y': base64.urlsafe_b64encode(y_bytes).decode().rstrip('='),
        'ext': True
    }
    
    # Save keys
    with open(key_file, 'w') as f:
        json.dump({
            'private_key': private_key_pem,
            'public_key_pem': public_key_pem,
            'public_key_jwk': public_key_jwk
        }, f, indent=2)
    
    return private_key


def get_bank_public_key_jwk():
    """
    Get bank's public key in JWK format for sharing with Receiver.
    """
    key_file = os.path.join(os.path.dirname(__file__), '..', 'bank_keys.json')
    
    if os.path.exists(key_file):
        with open(key_file, 'r') as f:
            key_data = json.load(f)
            return key_data['public_key_jwk']
    
    # Generate if doesn't exist
    get_or_create_bank_keypair()
    with open(key_file, 'r') as f:
        key_data = json.load(f)
        return key_data['public_key_jwk']

