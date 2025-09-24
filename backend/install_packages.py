#!/usr/bin/env python
import sys
import subprocess

def install_packages():
    """Install packages needed for the project."""
    packages = [
        'sqlalchemy-utils',
        'asyncpg',
        'pgvector',
        'sqlalchemy[asyncio]',
        'psycopg2-binary'
    ]
    
    print(f"Installing packages using Python: {sys.executable}")
    subprocess.check_call([sys.executable, '-m', 'pip', 'install'] + packages)
    print("Packages installed successfully!")

if __name__ == "__main__":
    install_packages()
