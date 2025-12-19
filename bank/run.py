"""
Simple script to run the FastAPI bank service.
Usage: python run.py
"""
import os
import sys
from pathlib import Path

# Add src directory to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

import uvicorn
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "4000"))
    # Only watch src directory, exclude venv
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        reload_dirs=["src"],  # Only watch src directory
        reload_excludes=["venv/**", "*.pyc", "__pycache__/**"],
        app_dir="src"
    )

