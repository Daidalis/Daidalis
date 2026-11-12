#!/bin/sh
# Upgrade boundary for existing launcher settings. Leave absent settings unset,
# so checkout-local configuration can still supply its defaults.
if [ "${DAIDALIS_NODE+x}" != x ] && [ "${MBSE_NODE+x}" = x ]; then
  DAIDALIS_NODE=$MBSE_NODE
  export DAIDALIS_NODE
fi
if [ "${DAIDALIS_DATA_DIR+x}" != x ] && [ "${MBSE_DATA_DIR+x}" = x ]; then
  DAIDALIS_DATA_DIR=$MBSE_DATA_DIR
  export DAIDALIS_DATA_DIR
fi
if [ "${DAIDALIS_FOREGROUND+x}" != x ] && [ "${MBSE_FOREGROUND+x}" = x ]; then
  DAIDALIS_FOREGROUND=$MBSE_FOREGROUND
  export DAIDALIS_FOREGROUND
fi
if [ "${DAIDALIS_NO_OPEN+x}" != x ] && [ "${MBSE_NO_OPEN+x}" = x ]; then
  DAIDALIS_NO_OPEN=$MBSE_NO_OPEN
  export DAIDALIS_NO_OPEN
fi
if [ "${DAIDALIS_PYTHON+x}" != x ] && [ "${MBSE_PYTHON+x}" = x ]; then
  DAIDALIS_PYTHON=$MBSE_PYTHON
  export DAIDALIS_PYTHON
fi
if [ "${DAIDALIS_ENGINEERING_DEPS+x}" != x ] && [ "${MBSE_ENGINEERING_DEPS+x}" = x ]; then
  DAIDALIS_ENGINEERING_DEPS=$MBSE_ENGINEERING_DEPS
  export DAIDALIS_ENGINEERING_DEPS
fi
if [ "${DAIDALIS_SOURCE_ROOT+x}" != x ] && [ "${MBSE_SOURCE_ROOT+x}" = x ]; then
  DAIDALIS_SOURCE_ROOT=$MBSE_SOURCE_ROOT
  export DAIDALIS_SOURCE_ROOT
fi
if [ "${DAIDALIS_NODE_MODULES+x}" != x ] && [ "${MBSE_NODE_MODULES+x}" = x ]; then
  DAIDALIS_NODE_MODULES=$MBSE_NODE_MODULES
  export DAIDALIS_NODE_MODULES
fi
if [ "${DAIDALIS_CHROME_PATH+x}" != x ] && [ "${MBSE_CHROME_PATH+x}" = x ]; then
  DAIDALIS_CHROME_PATH=$MBSE_CHROME_PATH
  export DAIDALIS_CHROME_PATH
fi

# Saved deployment files must be migrated before an installer rewrites them.
daidalis_has_legacy_settings() {
  grep -Eq '^[[:space:]]*(export[[:space:]]+)?(MANTA|MBSE|SYSPILOT)_' "$1"
}

# An already running pre-rename server still owns the selected port.
daidalis_health() {
  grep -Eq '"app"[[:space:]]*:[[:space:]]*"(daidalis|mbse-studio)"'
}
