#!/bin/sh
# Opt-in deployment, deliberately separate from the existing shared installer.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
[ "$#" -le 1 ] || { echo 'Too many arguments.' >&2; exit 2; }
case "${1:-}" in ''|--no-start) ;; *) echo 'Usage: sh deploy/docker/install-broker.sh [--no-start]' >&2; exit 2 ;; esac
export DOCKER_HOST=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}
unset DOCKER_CONTEXT
case "$DOCKER_HOST" in unix://*) ;; *) echo 'A local rootless Docker Unix socket is required.' >&2; exit 1 ;; esac
case "$(docker info --format '{{json .SecurityOptions}}')" in *name=rootless*) ;; *) echo 'Select a rootless Docker daemon; this installer will not configure the host or use rootful Docker.' >&2; exit 1 ;; esac
export MANTA_TASK_CPUS=${MANTA_TASK_CPUS:-2}
case "$MANTA_TASK_CPUS" in 0|1|2|4) ;; *) echo 'MANTA_TASK_CPUS must be 0, 1, 2 or 4.' >&2; exit 2 ;; esac
if [ "$(docker info --format '{{.CgroupVersion}} {{.CgroupDriver}} {{.MemoryLimit}} {{.PidsLimit}}')" != '2 systemd true true' ]; then
  echo 'Rootless cgroup v2 with delegated memory and PID controllers is required.' >&2; exit 1
fi
if [ "$MANTA_TASK_CPUS" != 0 ] && [ "$(docker info --format '{{.CPUCfsQuota}}')" != true ]; then
  echo 'CPU quota is unavailable. Explicitly set MANTA_TASK_CPUS=0 to run without a CPU quota; memory/PID/time limits remain.' >&2; exit 1
fi
export MANTA_ROOTLESS_SOCKET=${DOCKER_HOST#unix://}
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-manta-isolated}
export MANTA_TAG=${MANTA_TAG:-isolated}
export MANTA_PORT=${MANTA_PORT:-4320}
export MANTA_DESKTOP_PORT=${MANTA_DESKTOP_PORT:-6084}
export MANTA_ENV_FILE=${MANTA_ENV_FILE:-.env.example}
export MANTA_TOOLS=${MANTA_TOOLS-scipy,ngspice,openscad,browser,desktop,gis,freecad,scilab}
export MANTA_MODELICA=${MANTA_MODELICA:-1}
export MANTA_ORBIT42=${MANTA_ORBIT42:-1}
export MANTA_BROKER_FLIGHT=${MANTA_BROKER_FLIGHT:-0}
export MANTA_TASK_FLIGHT_IMAGE=
if [ "$MANTA_BROKER_FLIGHT" = 1 ]; then MANTA_TASK_FLIGHT_IMAGE=manta-flight:$MANTA_TAG; export MANTA_TASK_FLIGHT_IMAGE; fi
# Validate before expensive builds or overwriting saved configuration.
for value in "$DOCKER_HOST" "$MANTA_ROOTLESS_SOCKET" "$COMPOSE_PROJECT_NAME" "$MANTA_TAG" "$MANTA_ENV_FILE"; do
  case "$value" in ''|*[!a-zA-Z0-9_./:@+-]*) echo 'Unsupported character in deployment setting.' >&2; exit 2 ;; esac
done
case "$COMPOSE_PROJECT_NAME" in *[!a-z0-9_-]*|[_-]*) echo 'Invalid Compose project name.' >&2; exit 2 ;; esac
case "$MANTA_TAG" in *[!a-zA-Z0-9_.-]*|[.-]*) echo 'Invalid image tag.' >&2; exit 2 ;; esac
for port in "$MANTA_PORT" "$MANTA_DESKTOP_PORT"; do
  case "$port" in ''|*[!0-9]*) echo 'Ports must be integers.' >&2; exit 2 ;; esac
  if [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ] || [ "$port" = 8080 ] || [ "$port" = 8081 ]; then
    echo 'Ports must be 1024-65535, excluding internal ports 8080 and 8081.' >&2; exit 2
  fi
done
[ "$MANTA_PORT" != "$MANTA_DESKTOP_PORT" ] || { echo 'Ports must differ.' >&2; exit 2; }
[ -f "$MANTA_ENV_FILE" ] || { echo 'MANTA_ENV_FILE does not exist.' >&2; exit 2; }
for flag in "$MANTA_MODELICA" "$MANTA_ORBIT42" "$MANTA_BROKER_FLIGHT"; do
  case "$flag" in 0|1) ;; *) echo 'Tool flags must be 0 or 1.' >&2; exit 2 ;; esac
done
case ",$MANTA_TOOLS," in *,,*) [ -z "$MANTA_TOOLS" ] || { echo 'Empty tool group.' >&2; exit 2; } ;; esac
oldIFS=$IFS; IFS=,
for group in $MANTA_TOOLS; do
  case "$group" in scipy|ngspice|openscad|browser|desktop|gis|freecad|scilab) ;; *) echo "Unsupported tool group: $group" >&2; exit 2 ;; esac
done
IFS=$oldIFS
engine_major=$(docker info --format '{{.ServerVersion}}' | cut -d . -f 1)
case "$engine_major" in ''|*[!0-9]*) echo 'Cannot determine Docker Engine version.' >&2; exit 1 ;; esac
[ "$engine_major" -ge 26 ] || { echo 'Docker Engine 26+ is required for project volume subpaths.' >&2; exit 1; }
# Prevent inherited shared/flight profiles from enabling unisolated services.
export COMPOSE_PROFILES=
export COMPOSE_FILE=compose.yaml:deploy/docker/compose.broker.yaml
docker compose config --quiet
docker compose build manta broker
if [ "$MANTA_BROKER_FLIGHT" = 1 ]; then
  docker build --build-arg "MANTA_IMAGE=manta-app:$MANTA_TAG" -f deploy/docker/nos3-sdk.Dockerfile -t manta-nos3-sdk .
  docker build -f deploy/docker/nos3-native.Dockerfile -t manta-nos3-native-repro .
  docker build -f deploy/docker/flight.Dockerfile -t "$MANTA_TASK_FLIGHT_IMAGE" .
fi
export MANTA_ROOTLESS_SOCKET_GID=$(docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,src=$MANTA_ROOTLESS_SOCKET,dst=/run/socket,readonly" \
  --entrypoint stat "manta-broker:$MANTA_TAG" -c %g /run/socket)
case "$MANTA_ROOTLESS_SOCKET_GID" in ''|*[!0-9]*) echo 'Cannot determine socket group.' >&2; exit 1 ;; esac
mkdir -p deploy/local
umask 077
{
  printf 'COMPOSE_FILE=%s\nCOMPOSE_PROFILES=\nCOMPOSE_PROJECT_NAME=%s\n' "$COMPOSE_FILE" "$COMPOSE_PROJECT_NAME"
  printf 'MANTA_ROOTLESS_SOCKET=%s\nMANTA_ROOTLESS_SOCKET_GID=%s\n' "$MANTA_ROOTLESS_SOCKET" "$MANTA_ROOTLESS_SOCKET_GID"
  printf 'MANTA_TAG=%s\nMANTA_TASK_CPUS=%s\nMANTA_ENV_FILE=%s\n' "$MANTA_TAG" "$MANTA_TASK_CPUS" "$MANTA_ENV_FILE"
  printf 'MANTA_TOOLS=%s\nMANTA_MODELICA=%s\nMANTA_ORBIT42=%s\n' "$MANTA_TOOLS" "$MANTA_MODELICA" "$MANTA_ORBIT42"
  printf 'MANTA_BROKER_FLIGHT=%s\nMANTA_TASK_FLIGHT_IMAGE=%s\n' "$MANTA_BROKER_FLIGHT" "$MANTA_TASK_FLIGHT_IMAGE"
  printf 'MANTA_PORT=%s\nMANTA_DESKTOP_PORT=%s\n' "$MANTA_PORT" "$MANTA_DESKTOP_PORT"
} > deploy/local/broker.env
if [ "${1:-}" != --no-start ]; then docker compose up -d --force-recreate --wait; fi
echo "Broker mode configured. Open http://127.0.0.1:$MANTA_PORT with an API, Codex or Claude Agent."
echo "Maintain with DOCKER_HOST=$DOCKER_HOST docker compose --env-file deploy/local/broker.env ..."
