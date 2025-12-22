@echo off
REM Database setup script for Windows
REM Update the password below with your PostgreSQL password

set /p PGPASSWORD="Enter PostgreSQL Password: "
set DB_NAME=payment_gateway
set DB_USER=soham

echo Creating database...
createdb -U %DB_USER% %DB_NAME%

if %ERRORLEVEL% EQU 0 (
    echo Database created successfully!
    echo.
    echo Running schema...
    psql -U %DB_USER% -d %DB_NAME% -f schema.sql
    
    if %ERRORLEVEL% EQU 0 (
        echo.
        echo Database setup complete!
        echo.
        echo Update bank/.env file with:
        echo DATABASE_URL=postgresql://%DB_USER%:%PGPASSWORD%@localhost:5432/%DB_NAME%
    ) else (
        echo Error running schema
    )
) else (
    echo Error creating database
    echo Make sure PostgreSQL is running and password is correct
)

pause

