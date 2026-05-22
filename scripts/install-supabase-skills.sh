#!/usr/bin/env bash
set -euo pipefail

echo "Installing Supabase agent skills (requires npm)..."
npx skills add supabase/agent-skills

echo "Done."
