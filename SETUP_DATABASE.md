# Database Setup Guide

## Quick Setup (Windows)

### Option 1: Use the Setup Script

1. **Run the batch file:**
   ```powershell
   .\setup_database.bat
   ```

   This will automatically:
   - Create the database
   - Run the schema
   - Show you the DATABASE_URL to use

### Option 2: Manual Commands

Run these commands in PowerShell:

```powershell
# Set password as environment variable
$env:PGPASSWORD="Soham"

# Create database
createdb -U soham payment_gateway

# Run schema
psql -U soham -d payment_gateway -f schema.sql
```

### Option 3: Using psql with Password Prompt

```powershell
# Create database (will prompt for password)
createdb -U soham payment_gateway
# Enter password: Soham

# Run schema (will prompt for password)
psql -U soham -d payment_gateway -f schema.sql
# Enter password: Soham
```

## Configure Bank Server

After database is set up, create/update `bank/.env` file:

```bash
cd bank
copy env.sample .env
```

Edit `bank/.env` and set:

```
PORT=4000
DATABASE_URL=postgresql://soham:Soham@localhost:5432/payment_gateway
```

**Note:** Replace `soham` with your PostgreSQL username if different.

## Verify Setup

Test the connection:

```powershell
psql -U soham -d payment_gateway -c "SELECT COUNT(*) FROM users;"
```

Should return: `count: 0` (or number of users if any exist)

## Troubleshooting

### "password authentication failed"
- Make sure PostgreSQL service is running
- Verify password is correct (case-sensitive)
- Check username is correct

### "database does not exist"
- Run `createdb` command first
- Check database name spelling

### "relation does not exist"
- Run `schema.sql` to create tables
- Check you're connected to correct database

