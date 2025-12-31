#!/usr/bin/env bash

set -e

# Reads newline-separated test file paths or basenames from stdin
# If any test looks like a remixd test, ensure pip3/slither are available.

INPUT="$(cat || true)"

if [ -z "$INPUT" ]; then
  # Nothing to inspect
  exit 0
fi

if printf '%s\n' "$INPUT" | grep -Eiq '(^|/)(remixd|remixd_)'; then
  echo "Preparing pip3/slither for remixd tests"
  if ! command -v pip3 >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      echo "Installing python3 and pip3 via apt-get..."
      if command -v sudo >/dev/null 2>&1; then
        sudo apt-get update
        sudo apt-get install -y python3 python3-pip
      else
        apt-get update
        apt-get install -y python3 python3-pip
      fi
    else
      echo "pip3 not found and apt-get unavailable; skipping slither install"
      exit 0
    fi
  fi

  pip3 --version || true
  # Ensure user installs are on PATH
  mkdir -p "$HOME/.local/bin"
  export PATH="$HOME/.local/bin:$PATH"
  pip3 install --user slither-analyzer solc-select || true
  slither --version || true
else
  echo "No remixd tests detected; skipping slither setup"
fi
