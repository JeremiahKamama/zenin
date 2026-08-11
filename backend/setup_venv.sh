#!/bin/bash
# setup_venv.sh - Automate Python environment setup for Zenin Backend
# Robust against environments where the `venv` module may not be available.

echo "--- Zenin Python Environment Setup ---"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="venv"

# 1. Create venv if it doesn't exist or is broken.
if [ ! -x "${VENV_DIR}/bin/python3" ]; then
    echo "Creating virtual environment..."
    rm -rf "${VENV_DIR}"

    # Verify python3 is available before attempting venv creation.
    if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
        echo "WARNING: ${PYTHON_BIN} not found in PATH." >&2
        echo "Python-based enrichment (fetch_prices, fetch_company_profile, etc.)" >&2
        echo "will be unavailable. Build continues — Node.js backend starts without the venv." >&2
        echo "--- Python Setup Skipped (non-fatal) ---"
        exit 0
    fi

    # Try standard library venv first.
    "${PYTHON_BIN}" -m venv "${VENV_DIR}" 2>/dev/null

    # Fallback: venv module may not be installed (common on slim Docker images /
    # some CI environments). Try the standalone `virtualenv` package instead.
    if [ ! -x "${VENV_DIR}/bin/python3" ]; then
        echo "Standard venv unavailable; trying virtualenv..."
        pip3 install --user virtualenv 2>/dev/null || pip install --user virtualenv 2>/dev/null || true
        "${PYTHON_BIN}" -m virtualenv "${VENV_DIR}" 2>/dev/null || true
    fi
fi

if [ ! -x "${VENV_DIR}/bin/python3" ]; then
    echo "WARNING: Could not create Python virtual environment." >&2
    echo "Python-based enrichment (fetch_prices, fetch_company_profile, etc.)" >&2
    echo "will fall back to system python3 if available, or be unavailable." >&2
    echo "Build continues — Node.js backend starts without the venv." >&2
    echo "--- Python Setup Skipped (non-fatal) ---"
    exit 0
fi

# 2. Upgrade pip
echo "Upgrading pip..."
"${VENV_DIR}/bin/python3" -m pip install --upgrade pip 2>&1 || {
    echo "WARNING: pip upgrade failed, continuing with bundled pip..." >&2
}

# 3. Install compatible versions
echo "Installing dependencies..."
"${VENV_DIR}/bin/pip" install -r requirements.txt || {
    echo "WARNING: pip install failed — Python enrichment may not be available." >&2
    echo "Build continues — Node.js backend starts without Python dependencies." >&2
    echo "--- Python Setup Incomplete (non-fatal) ---"
    exit 0
}

echo "--- Setup Complete ---"
echo "To use this environment manually: source venv/bin/activate"
