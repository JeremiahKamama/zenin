#!/bin/bash
# setup_venv.sh - Automate Python environment setup for Zenin Backend

echo "--- Zenin Python Environment Setup ---"

# 1. Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# 2. Upgrade pip
echo "Upgrading pip..."
./venv/bin/python3 -m pip install --upgrade pip

# 3. Install compatible versions
echo "Installing dependencies..."
./venv/bin/pip install -r requirements.txt || exit 1

echo "--- Setup Complete ---"
echo "To use this environment manually: source venv/bin/activate"
