# Fixing PostgreSQL Connection Issues

## Issue: Password Authentication Failed

If you're getting "password authentication failed", try these solutions:

## Solution 1: Use pgAdmin or psql GUI

1. **Open pgAdmin** (PostgreSQL GUI tool)
2. Connect to your PostgreSQL server
3. Right-click "Databases" → "Create" → "Database"
4. Name: `payment_gateway`
5. Click "Save"

Then run the schema:
- Right-click on `payment_gateway` database → "Query Tool"
- Open `schema.sql` file
- Copy and paste the contents
- Click "Execute" (F5)

## Solution 2: Use psql with Connection String

```powershell
# Try connecting directly with connection string
psql "postgresql://soham:Soham@localhost:5432/postgres"

# If that works, create database:
psql "postgresql://soham:Soham@localhost:5432/postgres" -c "CREATE DATABASE payment_gateway;"

# Then run schema:
psql "postgresql://soham:Soham@localhost:5432/payment_gateway" -f schema.sql
```

## Solution 3: Check PostgreSQL Authentication

1. **Find pg_hba.conf file:**
   - Usually in: `C:\Program Files\PostgreSQL\[version]\data\pg_hba.conf`
   - Or: `C:\Users\soham\AppData\Local\PostgreSQL\data\pg_hba.conf`

2. **Check authentication method:**
   - Look for line: `host all all 127.0.0.1/32 md5`
   - If it says `trust` or `scram-sha-256`, that's fine
   - If it says `ident` or `peer`, change to `md5`

3. **Restart PostgreSQL service:**
   ```powershell
   # As Administrator
   Restart-Service postgresql-x64-[version]
   ```

## Solution 4: Use Windows Authentication

If PostgreSQL is configured for Windows authentication:

```powershell
# Connect without password (uses Windows login)
createdb -U postgres payment_gateway
psql -U postgres -d payment_gateway -f schema.sql
```

## Solution 5: Reset PostgreSQL Password

If password is definitely wrong:

```powershell
# Connect as postgres superuser
psql -U postgres

# Then in psql:
ALTER USER soham WITH PASSWORD 'Soham';
\q
```

## Solution 6: Create Database Manually via SQL

1. **Connect to default database:**
   ```powershell
   psql -U postgres
   # Or try: psql -U soham -d postgres
   ```

2. **In psql prompt:**
   ```sql
   CREATE DATABASE payment_gateway;
   \c payment_gateway
   ```

3. **Then copy-paste schema.sql contents:**
   ```sql
   CREATE TABLE IF NOT EXISTS audit_logs (...);
   -- etc.
   ```

## Quick Test

Test if you can connect at all:

```powershell
# Try default postgres user
psql -U postgres

# Or try your username
psql -U soham -d postgres
```

## Alternative: Use SQLite (Easier for Testing)

If PostgreSQL is too complicated, we can modify the app to use SQLite instead (simpler, no password needed).

Let me know which solution works for you!

