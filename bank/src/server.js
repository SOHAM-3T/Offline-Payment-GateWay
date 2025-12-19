import fs from 'fs';
import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import pkg from 'pg';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pkg;
const PORT = process.env.PORT || 4000;
const DATABASE_URL = process.env.DATABASE_URL;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  res.json({
    message: 'Offline bank reconciliation service',
    endpoints: {
      import: 'POST /ledger/import',
      logs: 'GET /logs'
    }
  });
});

app.post('/ledger/import', async (req, res) => {
  try {
    const ledger = req.body;
    if (!Array.isArray(ledger)) {
      return res.status(400).json({ error: 'Ledger must be an array' });
    }
    const report = await reconcileLedger(ledger);
    await writeAuditLog({
      actor: 'bank',
      action: 'reconcile',
      status: report.valid ? 'success' : 'error',
      txn_id: null,
      details: report
    });
    return res.json(report);
  } catch (err) {
    console.error(err);
    await writeAuditLog({
      actor: 'bank',
      action: 'reconcile',
      status: 'error',
      txn_id: null,
      details: { message: err.message }
    });
    return res.status(500).json({ error: err.message });
  }
});

app.get('/logs', async (_req, res) => {
  try {
    if (pool) {
      const { rows } = await pool.query(
        'SELECT id, actor, action, txn_id, status, details, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100'
      );
      return res.json(rows);
    }
    const filePath = path.join(__dirname, '..', 'audit-log.jsonl');
    if (!fs.existsSync(filePath)) return res.json([]);
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
    const parsed = lines.map((line) => JSON.parse(line)).reverse().slice(0, 100);
    return res.json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Bank service listening on http://localhost:${PORT}`);
  if (!pool) {
    console.warn('DATABASE_URL not set; audit logs will be written to audit-log.jsonl');
  }
});

async function reconcileLedger(ledgerEntries) {
  let prevHash = 'GENESIS';
  let valid = true;
  const failures = [];

  for (const entry of ledgerEntries) {
    const { ledger_index, transaction, hash } = entry;
    const canonical = canonicalTransactionString(transaction);
    const computedTxnHash = await sha256Hex(canonical);
    if (computedTxnHash !== transaction.hash) {
      valid = false;
      failures.push({ ledger_index, reason: 'transaction hash mismatch' });
      continue;
    }
    const chainHash = await sha256Hex(prevHash + transaction.hash);
    if (chainHash !== hash) {
      valid = false;
      failures.push({ ledger_index, reason: 'ledger hash mismatch' });
      continue;
    }
    const signatureOk = await verifySignature(transaction);
    if (!signatureOk) {
      valid = false;
      failures.push({ ledger_index, reason: 'signature invalid' });
      continue;
    }
    prevHash = hash;
  }

  return {
    valid,
    entries: ledgerEntries.length,
    failures
  };
}

async function verifySignature(txn) {
  const publicKey = await crypto.webcrypto.subtle.importKey(
    'jwk',
    txn.sender_public_key,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  const sigBuffer = base64ToBuffer(txn.signature);
  return crypto.webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    sigBuffer,
    hexToBuffer(txn.hash)
  );
}

async function writeAuditLog(entry) {
  const record = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...entry
  };
  if (pool) {
    try {
      await pool.query(
        'INSERT INTO audit_logs(id, actor, action, txn_id, status, details, created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [record.id, record.actor, record.action, record.txn_id, record.status, record.details, record.created_at]
      );
      return;
    } catch (err) {
      console.error('Failed to write audit log to Postgres, falling back to file.', err);
    }
  }
  const filePath = path.join(__dirname, '..', 'audit-log.jsonl');
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
}

function canonicalTransactionString(txn) {
  const ordered = {
    txn_id: txn.txn_id,
    from_id: txn.from_id,
    to_id: txn.to_id,
    amount: Number(txn.amount),
    timestamp: txn.timestamp,
    prev_hash: txn.prev_hash ?? ''
  };
  return JSON.stringify(ordered);
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.webcrypto.subtle.digest('SHA-256', data);
  return bufferToHex(hash);
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
  return bytes.buffer;
}

function base64ToBuffer(b64) {
  const binary = Buffer.from(b64, 'base64');
  return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

