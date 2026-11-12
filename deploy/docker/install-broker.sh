#!/bin/sh
# Opt-in deployment, deliberately separate from the existing shared installer.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
[ "$#" -le 1 ] || { echo 'Too many arguments.' >&2; exit 2; }
case "${1:-}" in ''|--no-start) ;; *) echo 'Usage: sh deploy/docker/install-broker.sh [--no-start]' >&2; exit 2 ;; esac
. ./scripts/legacy-env.sh
saved_broker=deploy/local/broker.env
saved_project=
migration_override=
if [ -f "$saved_broker" ]; then
  if daidalis_has_legacy_settings "$saved_broker"; then
    echo 'Existing installation needs the name migration first: python3 deploy/docker/migrate-name.py --apply' >&2
    exit 2
  fi
  saved_project=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$saved_broker")
  case "$(sed -n 's/^COMPOSE_FILE=//p' "$saved_broker")" in
    *deploy/local/name-migration.compose.yaml*) migration_override=:deploy/local/name-migration.compose.yaml ;;
  esac
  export DAIDALIS_BROKER_ID=${DAIDALIS_BROKER_ID:-$(sed -n 's/^DAIDALIS_BROKER_ID=//p' "$saved_broker")}
  export DAIDALIS_TASK_PROJECTS_VOLUME=${DAIDALIS_TASK_PROJECTS_VOLUME:-$(sed -n 's/^DAIDALIS_TASK_PROJECTS_VOLUME=//p' "$saved_broker")}
  export DAIDALIS_MODEL_VOLUME=${DAIDALIS_MODEL_VOLUME:-$(sed -n 's/^DAIDALIS_MODEL_VOLUME=//p' "$saved_broker")}
fi
export DOCKER_HOST=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}
unset DOCKER_CONTEXT
case "$DOCKER_HOST" in unix://*) ;; *) echo 'A local rootless Docker Unix socket is required.' >&2; exit 1 ;; esac
case "$(docker info --format '{{json .SecurityOptions}}')" in *name=rootless*) ;; *) echo 'Select a rootless Docker daemon; this installer will not configure the host or use rootful Docker.' >&2; exit 1 ;; esac
export DAIDALIS_TASK_CPUS=${DAIDALIS_TASK_CPUS:-2}
case "$DAIDALIS_TASK_CPUS" in 0|1|2|4) ;; *) echo 'DAIDALIS_TASK_CPUS must be 0, 1, 2 or 4.' >&2; exit 2 ;; esac
if [ "$(docker info --format '{{.CgroupVersion}} {{.CgroupDriver}} {{.MemoryLimit}} {{.PidsLimit}}')" != '2 systemd true true' ]; then
  echo 'Rootless cgroup v2 with delegated memory and PID controllers is required.' >&2; exit 1
fi
if [ "$DAIDALIS_TASK_CPUS" != 0 ] && [ "$(docker info --format '{{.CPUCfsQuota}}')" != true ]; then
  echo 'CPU quota is unavailable. Explicitly set DAIDALIS_TASK_CPUS=0 to run without a CPU quota; memory/PID/time limits remain.' >&2; exit 1
fi
export DAIDALIS_ROOTLESS_SOCKET=${DOCKER_HOST#unix://}
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-${saved_project:-daidalis-isolated}}
export DAIDALIS_TAG=${DAIDALIS_TAG:-isolated}
export DAIDALIS_PORT=${DAIDALIS_PORT:-4320}
export DAIDALIS_DESKTOP_PORT=${DAIDALIS_DESKTOP_PORT:-6084}
export DAIDALIS_ENV_FILE=${DAIDALIS_ENV_FILE:-.env.example}
export DAIDALIS_TOOLS=${DAIDALIS_TOOLS-scipy,ngspice,openscad,browser,desktop,gis,freecad,scilab,sysmlsim}
export DAIDALIS_MODELICA=${DAIDALIS_MODELICA:-1}
export DAIDALIS_ORBIT42=${DAIDALIS_ORBIT42:-1}
export DAIDALIS_SYML_SIM=${DAIDALIS_SYML_SIM:-1}
export DAIDALIS_BROKER_FLIGHT=${DAIDALIS_BROKER_FLIGHT:-0}
export DAIDALIS_TASK_FLIGHT_IMAGE=
if [ "$DAIDALIS_BROKER_FLIGHT" = 1 ]; then DAIDALIS_TASK_FLIGHT_IMAGE=daidalis-flight:$DAIDALIS_TAG; export DAIDALIS_TASK_FLIGHT_IMAGE; fi
# Validate before expensive builds or overwriting saved configuration.
for value in "$DOCKER_HOST" "$DAIDALIS_ROOTLESS_SOCKET" "$COMPOSE_PROJECT_NAME" "$DAIDALIS_TAG" "$DAIDALIS_ENV_FILE"; do
  case "$value" in ''|*[!a-zA-Z0-9_./:@+-]*) echo 'Unsupported character in deployment setting.' >&2; exit 2 ;; esac
done
case "$COMPOSE_PROJECT_NAME" in *[!a-z0-9_-]*|[_-]*) echo 'Invalid Compose project name.' >&2; exit 2 ;; esac
case "$DAIDALIS_TAG" in *[!a-zA-Z0-9_.-]*|[.-]*) echo 'Invalid image tag.' >&2; exit 2 ;; esac
for port in "$DAIDALIS_PORT" "$DAIDALIS_DESKTOP_PORT"; do
  case "$port" in ''|*[!0-9]*) echo 'Ports must be integers.' >&2; exit 2 ;; esac
  if [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ] || [ "$port" = 8080 ] || [ "$port" = 8081 ]; then
    echo 'Ports must be 1024-65535, excluding internal ports 8080 and 8081.' >&2; exit 2
  fi
done
[ "$DAIDALIS_PORT" != "$DAIDALIS_DESKTOP_PORT" ] || { echo 'Ports must differ.' >&2; exit 2; }
[ -f "$DAIDALIS_ENV_FILE" ] || { echo 'DAIDALIS_ENV_FILE does not exist.' >&2; exit 2; }
for flag in "$DAIDALIS_MODELICA" "$DAIDALIS_ORBIT42" "$DAIDALIS_BROKER_FLIGHT" "$DAIDALIS_SYML_SIM"; do
  case "$flag" in 0|1) ;; *) echo 'Tool flags must be 0 or 1.' >&2; exit 2 ;; esac
done
case ",$DAIDALIS_TOOLS," in *,,*) [ -z "$DAIDALIS_TOOLS" ] || { echo 'Empty tool group.' >&2; exit 2; } ;; esac
oldIFS=$IFS; IFS=,
for group in $DAIDALIS_TOOLS; do
  case "$group" in scipy|ngspice|openscad|browser|desktop|gis|freecad|scilab|sysmlsim) ;; *) echo "Unsupported tool group: $group" >&2; exit 2 ;; esac
done
IFS=$oldIFS
engine_major=$(docker info --format '{{.ServerVersion}}' | cut -d . -f 1)
case "$engine_major" in ''|*[!0-9]*) echo 'Cannot determine Docker Engine version.' >&2; exit 1 ;; esac
[ "$engine_major" -ge 26 ] || { echo 'Docker Engine 26+ is required for project volume subpaths.' >&2; exit 1; }
# Prevent inherited shared/flight profiles from enabling unisolated services.
export COMPOSE_PROFILES=
export COMPOSE_FILE=compose.yaml:deploy/docker/compose.broker.yaml$migration_override
docker compose config --quiet
docker compose build daidalis broker
if [ "$DAIDALIS_BROKER_FLIGHT" = 1 ]; then
  docker build --build-arg "DAIDALIS_IMAGE=daidalis-app:$DAIDALIS_TAG" -f deploy/docker/nos3-sdk.Dockerfile -t daidalis-nos3-sdk .
  docker build -f deploy/docker/nos3-native.Dockerfile -t daidalis-nos3-native-repro .
  docker build -f deploy/docker/flight.Dockerfile -t "$DAIDALIS_TASK_FLIGHT_IMAGE" .
fi
export DAIDALIS_ROOTLESS_SOCKET_GID=$(docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,src=$DAIDALIS_ROOTLESS_SOCKET,dst=/run/socket,readonly" \
  --entrypoint stat "daidalis-broker:$DAIDALIS_TAG" -c %g /run/socket)
case "$DAIDALIS_ROOTLESS_SOCKET_GID" in ''|*[!0-9]*) echo 'Cannot determine socket group.' >&2; exit 1 ;; esac
mkdir -p deploy/local
umask 077
{
  printf 'COMPOSE_FILE=%s\nCOMPOSE_PROFILES=\nCOMPOSE_PROJECT_NAME=%s\n' "$COMPOSE_FILE" "$COMPOSE_PROJECT_NAME"
  printf 'DAIDALIS_ROOTLESS_SOCKET=%s\nDAIDALIS_ROOTLESS_SOCKET_GID=%s\n' "$DAIDALIS_ROOTLESS_SOCKET" "$DAIDALIS_ROOTLESS_SOCKET_GID"
  printf 'DAIDALIS_TAG=%s\nDAIDALIS_TASK_CPUS=%s\nDAIDALIS_ENV_FILE=%s\n' "$DAIDALIS_TAG" "$DAIDALIS_TASK_CPUS" "$DAIDALIS_ENV_FILE"
  printf 'DAIDALIS_TOOLS=%s\nDAIDALIS_MODELICA=%s\nDAIDALIS_ORBIT42=%s\nDAIDALIS_SYML_SIM=%s\n' "$DAIDALIS_TOOLS" "$DAIDALIS_MODELICA" "$DAIDALIS_ORBIT42" "$DAIDALIS_SYML_SIM"
  printf 'DAIDALIS_BROKER_FLIGHT=%s\nDAIDALIS_TASK_FLIGHT_IMAGE=%s\n' "$DAIDALIS_BROKER_FLIGHT" "$DAIDALIS_TASK_FLIGHT_IMAGE"
  printf 'DAIDALIS_PORT=%s\nDAIDALIS_DESKTOP_PORT=%s\n' "$DAIDALIS_PORT" "$DAIDALIS_DESKTOP_PORT"
  printf 'DAIDALIS_BROKER_ID=%s\nDAIDALIS_TASK_PROJECTS_VOLUME=%s\nDAIDALIS_MODEL_VOLUME=%s\n' "${DAIDALIS_BROKER_ID:-}" "${DAIDALIS_TASK_PROJECTS_VOLUME:-}" "${DAIDALIS_MODEL_VOLUME:-}"
} > deploy/local/broker.env
if [ "${1:-}" != --no-start ]; then docker compose up -d --force-recreate --wait; fi
echo "Broker mode configured. Open http://127.0.0.1:$DAIDALIS_PORT with an API, Codex or Claude Agent."
echo "Maintain with DOCKER_HOST=$DOCKER_HOST docker compose --env-file deploy/local/broker.env ..."
