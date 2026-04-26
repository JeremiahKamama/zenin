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
# Note: We use specific versions for Python 3.8 compatibility
echo "Installing dependencies..."
./venv/bin/pip install multitasking==0.0.11 yfinance==0.2.40 requests beautifulsoup4 pandas

echo "--- Setup Complete ---"
echo "To use this environment manually: source venv/bin/activate"
