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

