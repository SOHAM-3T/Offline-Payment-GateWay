#!/bin/bash
# Database setup script for Linux/Mac
# Update the password below with your PostgreSQL password

export PGPASSWORD=Soham
DB_NAME=payment_gateway
DB_USER=soham

echo "Creating database..."
createdb -U $DB_USER $DB_NAME

if [ $? -eq 0 ]; then
    echo "Database created successfully!"
    echo ""
    echo "Running schema..."
    psql -U $DB_USER -d $DB_NAME -f schema.sql
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "Database setup complete!"
        echo ""
        echo "Update bank/.env file with:"
        echo "DATABASE_URL=postgresql://$DB_USER:Soham@localhost:5432/$DB_NAME"
    else
        echo "Error running schema"
    fi
else
    echo "Error creating database"
    echo "Make sure PostgreSQL is running and password is correct"
fi

