#!/bin/sh
set -eu

# Install only the numerical-analysis dependencies, inside this project.
# The interpreter and target may be changed without editing the script.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname -- "$SCRIPT_DIR")
PYTHON_BIN=${MBSE_PYTHON:-}
TARGET_DIR=${MBSE_ENGINEERING_DEPS:-"${PROJECT_DIR}/.local/engineering-deps"}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --python) [ "$#" -ge 2 ] || { echo 'Missing --python path' >&2; exit 2; }; PYTHON_BIN=$2; shift 2 ;;
    --target) [ "$#" -ge 2 ] || { echo 'Missing --target path' >&2; exit 2; }; TARGET_DIR=$2; shift 2 ;;
    --help|-h) echo 'Usage: sh scripts/install-engineering.sh [--python /path/to/python3] [--target /absolute/dependency/path]'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$PYTHON_BIN" ]; then
  PYTHON_BIN=$(command -v python3 || true)
fi
[ -n "$PYTHON_BIN" ] || { echo 'Python 3.12–3.14 is required; set MBSE_PYTHON or --python.' >&2; exit 1; }
"$PYTHON_BIN" -c 'import sys; assert (3,12) <= sys.version_info[:2] < (3,15), "Use Python 3.12–3.14 for these pinned wheels"'
mkdir -p "$TARGET_DIR"
"$PYTHON_BIN" -m pip install --disable-pip-version-check --only-binary=:all: --target "$TARGET_DIR" 'numpy==2.5.4' 'scipy==1.18.1' 'matplotlib==3.11.2'
"$PYTHON_BIN" -I -c 'import sys; sys.path.insert(0,sys.argv[1]); import numpy,scipy,matplotlib; print("Installed:","numpy",numpy.__version__,"scipy",scipy.__version__,"matplotlib",matplotlib.__version__)' "$TARGET_DIR"
printf '%s\n' 'Engineering dependencies are ready. If using a custom interpreter/target, set MBSE_PYTHON and MBSE_ENGINEERING_DEPS when starting the studio.'
