# Test PostgreSQL Connection Script
# Run this to diagnose connection issues

Write-Host "Testing PostgreSQL Connection..." -ForegroundColor Cyan
Write-Host ""

# Test 1: Try connecting with postgres user
Write-Host "Test 1: Connecting as 'postgres' user..." -ForegroundColor Yellow
$test1 = & psql -U postgres -d postgres -c "SELECT version();" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Successfully connected as 'postgres'" -ForegroundColor Green
    Write-Host "You can use: psql -U postgres" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Failed to connect as 'postgres'" -ForegroundColor Red
    Write-Host $test1
}

Write-Host ""

# Test 2: Try connecting with soham user
Write-Host "Test 2: Connecting as 'soham' user..." -ForegroundColor Yellow
$env:PGPASSWORD = Read-Host -Prompt "Enter PostgreSQL Password for 'soham'"
$test2 = & psql -U soham -d postgres -c "SELECT version();" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Successfully connected as 'soham'" -ForegroundColor Green
    Write-Host "Password is correct!" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Failed to connect as 'soham'" -ForegroundColor Red
    Write-Host $test2
}

Write-Host ""

# Test 3: Check if PostgreSQL service is running
Write-Host "Test 3: Checking PostgreSQL service..." -ForegroundColor Yellow
$service = Get-Service -Name "*postgresql*" -ErrorAction SilentlyContinue
if ($service) {
    Write-Host "[OK] PostgreSQL service found: $($service.Name)" -ForegroundColor Green
    Write-Host "  Status: $($service.Status)" -ForegroundColor $(if ($service.Status -eq 'Running') { 'Green' } else { 'Red' })
    if ($service.Status -ne 'Running') {
        Write-Host "  Try: Start-Service $($service.Name)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[FAIL] PostgreSQL service not found" -ForegroundColor Red
    Write-Host "  Make sure PostgreSQL is installed" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Recommendations:" -ForegroundColor Cyan
Write-Host "1. If Test 1 works: Use 'postgres' user to create database" -ForegroundColor White
Write-Host "2. If Test 2 works: Password is correct, proceed with setup" -ForegroundColor White
Write-Host "3. If both fail: Check PostgreSQL installation and service" -ForegroundColor White
