"""
Database connection and operations for PostgreSQL audit logs.
"""
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import List, Optional
from datetime import datetime
import json


def get_db_connection():
    """Get PostgreSQL connection from DATABASE_URL environment variable."""
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        raise ValueError("DATABASE_URL environment variable not set")
    return psycopg2.connect(database_url)


def write_audit_log(
    actor: str,
    action: str,
    status: str,
    details: dict,
    txn_id: Optional[str] = None
) -> str:
    """
    Write audit log to PostgreSQL.
    Returns the log ID (UUID).
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO audit_logs (actor, action, txn_id, status, details)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id::text
                """,
                (actor, action, txn_id, status, json.dumps(details))
            )
            log_id = cur.fetchone()[0]
            conn.commit()
            return log_id
    finally:
        conn.close()


def get_audit_logs(limit: int = 100, offset: int = 0) -> List[dict]:
    """
    Retrieve audit logs from PostgreSQL.
    Returns list of log dictionaries.
    """
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT 
                    id::text as log_id,
                    actor,
                    action,
                    txn_id,
                    status,
                    details,
                    created_at::text as timestamp
                FROM audit_logs
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset)
            )
            logs = cur.fetchall()
            return [dict(log) for log in logs]
    finally:
        conn.close()


def check_transaction_settled(txn_id: str) -> bool:
    """
    Check if a transaction has already been settled.
    Returns True if transaction exists in audit logs with action='settle'.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) FROM audit_logs
                WHERE txn_id = %s AND action = 'settle' AND status = 'success'
                """,
                (txn_id,)
            )
            count = cur.fetchone()[0]
            return count > 0
    finally:
        conn.close()


# User/KYC Functions
def create_user(full_name: str, email_or_phone: str, role: str, bank_id: str, public_key_jwk: dict) -> str:
    """Create a new user with KYC registration. Returns user_id."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (full_name, email_or_phone, role, bank_id, public_key_jwk, kyc_status)
                VALUES (%s, %s, %s, %s, %s, 'pending')
                RETURNING user_id::text
                """,
                (full_name, email_or_phone, role, bank_id, json.dumps(public_key_jwk))
            )
            user_id = cur.fetchone()[0]
            conn.commit()
            return user_id
    except psycopg2.IntegrityError as e:
        conn.rollback()
        raise ValueError(f"User already exists: {str(e)}")
    finally:
        conn.close()


def update_user_kyc_status(user_id: str, kyc_status: str) -> bool:
    """Update user KYC status. Returns True if successful."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE users
                SET kyc_status = %s, updated_at = NOW()
                WHERE user_id = %s
                """,
                (kyc_status, user_id)
            )
            updated = cur.rowcount > 0
            conn.commit()
            return updated
    finally:
        conn.close()


def get_user(user_id: str) -> Optional[dict]:
    """Get user by user_id. Returns None if not found."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT 
                    user_id::text,
                    full_name,
                    email_or_phone,
                    role,
                    bank_id,
                    kyc_status,
                    created_at::text,
                    updated_at::text
                FROM users
                WHERE user_id = %s
                """,
                (user_id,)
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_bank_id(bank_id: str, role: str) -> Optional[dict]:
    """Get user by bank_id and role. Returns None if not found."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT 
                    user_id::text,
                    full_name,
                    email_or_phone,
                    role,
                    bank_id,
                    kyc_status,
                    created_at::text,
                    updated_at::text
                FROM users
                WHERE bank_id = %s AND role = %s
                """,
                (bank_id, role)
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def get_all_users(kyc_status: Optional[str] = None) -> List[dict]:
    """Get all users, optionally filtered by kyc_status."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if kyc_status:
                cur.execute(
                    """
                    SELECT 
                        user_id::text,
                        full_name,
                        email_or_phone,
                        role,
                        bank_id,
                        kyc_status,
                        created_at::text,
                        updated_at::text
                    FROM users
                    WHERE kyc_status = %s
                    ORDER BY created_at DESC
                    """,
                    (kyc_status,)
                )
            else:
                cur.execute(
                    """
                    SELECT 
                        user_id::text,
                        full_name,
                        email_or_phone,
                        role,
                        bank_id,
                        kyc_status,
                        created_at::text,
                        updated_at::text
                    FROM users
                    ORDER BY created_at DESC
                    """
                )
            rows = cur.fetchall()
            return [dict(row) for row in rows]
    finally:
        conn.close()


# Wallet Functions
def create_wallet(user_id: str, requested_limit: float) -> str:
    """Create a new wallet request. Returns wallet_id."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO wallets (user_id, approved_limit, current_balance, status)
                VALUES (%s, %s, %s, 'pending')
                RETURNING wallet_id::text
                """,
                (user_id, requested_limit, requested_limit)  # Initially set balance to requested limit
            )
            wallet_id = cur.fetchone()[0]
            conn.commit()
            return wallet_id
    except psycopg2.IntegrityError as e:
        conn.rollback()
        raise ValueError(f"Wallet already exists for user: {str(e)}")
    finally:
        conn.close()


def approve_wallet(wallet_id: str, approved_limit: float) -> bool:
    """Approve wallet and lock the amount. Returns True if successful."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Update wallet status and lock the amount
            cur.execute(
                """
                UPDATE wallets
                SET status = 'approved',
                    approved_limit = %s,
                    current_balance = %s,
                    locked_amount = %s,
                    updated_at = NOW()
                WHERE wallet_id = %s
                """,
                (approved_limit, approved_limit, approved_limit, wallet_id)
            )
            updated = cur.rowcount > 0
            conn.commit()
            return updated
    finally:
        conn.close()


def get_wallet(wallet_id: str) -> Optional[dict]:
    """Get wallet by wallet_id. Returns None if not found."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT 
                    wallet_id::text,
                    user_id::text,
                    approved_limit,
                    current_balance,
                    used_amount,
                    locked_amount,
                    status,
                    created_at::text,
                    updated_at::text
                FROM wallets
                WHERE wallet_id = %s
                """,
                (wallet_id,)
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def get_wallet_by_user_id(user_id: str) -> Optional[dict]:
    """Get wallet by user_id. Returns None if not found."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT 
                    wallet_id::text,
                    user_id::text,
                    approved_limit,
                    current_balance,
                    used_amount,
                    locked_amount,
                    status,
                    created_at::text,
                    updated_at::text
                FROM wallets
                WHERE user_id = %s
                """,
                (user_id,)
            )
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def update_wallet_balance(wallet_id: str, amount: float) -> bool:
    """Deduct amount from wallet balance and add to used_amount. Returns True if successful."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check current balance
            cur.execute(
                """
                SELECT current_balance, approved_limit
                FROM wallets
                WHERE wallet_id = %s AND status = 'approved'
                """,
                (wallet_id,)
            )
            row = cur.fetchone()
            if not row:
                return False
            current_balance, approved_limit = row
            
            # Check if sufficient balance
            if current_balance < amount:
                return False
            
            # Update balance
            cur.execute(
                """
                UPDATE wallets
                SET current_balance = current_balance - %s,
                    used_amount = used_amount + %s,
                    updated_at = NOW()
                WHERE wallet_id = %s AND current_balance >= %s
                """,
                (amount, amount, wallet_id, amount)
            )
            updated = cur.rowcount > 0
            conn.commit()
            return updated
    finally:
        conn.close()


def settle_transaction_to_wallet(txn_id: str, wallet_id: str, from_user_id: str, to_user_id: str, 
                                  amount: float, ledger_index: Optional[int] = None, 
                                  receiver_id: Optional[str] = None) -> str:
    """Record a settled transaction and deduct from wallet locked amount. Returns settlement ID."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Insert into settled_transactions
            cur.execute(
                """
                INSERT INTO settled_transactions 
                    (txn_id, wallet_id, from_user_id, to_user_id, amount, ledger_index, receiver_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id::text
                """,
                (txn_id, wallet_id, from_user_id, to_user_id, amount, ledger_index, receiver_id)
            )
            settlement_id = cur.fetchone()[0]
            
            # Deduct from locked_amount (escrow)
            cur.execute(
                """
                UPDATE wallets
                SET locked_amount = locked_amount - %s,
                    updated_at = NOW()
                WHERE wallet_id = %s AND locked_amount >= %s
                """,
                (amount, wallet_id, amount)
            )
            
            conn.commit()
            return settlement_id
    except psycopg2.IntegrityError:
        conn.rollback()
        raise ValueError(f"Transaction {txn_id} already settled")
    finally:
        conn.close()


def check_wallet_balance_sufficient(wallet_id: str, amount: float) -> bool:
    """Check if wallet has sufficient balance. Returns True if sufficient."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT current_balance
                FROM wallets
                WHERE wallet_id = %s AND status = 'approved'
                """,
                (wallet_id,)
            )
            row = cur.fetchone()
            if not row:
                return False
            current_balance = float(row[0])
            return current_balance >= amount
    finally:
        conn.close()
