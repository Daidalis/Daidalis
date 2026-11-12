#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
preset=full
tools=
custom=false
start=true
modelica=0
orbit42=0
nos3=0
sysmlsim=0
for arg in "$@"; do
  case "$arg" in
    --preset=full) preset=full ;;
    --preset=minimal) preset=minimal ;;
    --tools=*) tools=${arg#--tools=}; custom=true; preset=custom ;;
    --no-start) start=false ;;
    --help) echo 'Usage: sh install.sh [--preset=full|minimal | --tools=scipy,ngspice,openscad,browser,desktop,modelica,sysmlsim,gis,freecad,scilab,orbit42,nos3] [--no-start]'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
. ./scripts/legacy-env.sh
saved_install=deploy/local/install.env
saved_project=
migration_override=
if [ -f "$saved_install" ]; then
  if daidalis_has_legacy_settings "$saved_install"; then
    echo 'Existing installation needs the name migration first: python3 deploy/docker/migrate-name.py --apply' >&2
    exit 2
  fi
  saved_project=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$saved_install")
  case "$(sed -n 's/^COMPOSE_FILE=//p' "$saved_install")" in
    *deploy/local/name-migration.compose.yaml*) migration_override=:deploy/local/name-migration.compose.yaml ;;
  esac
fi
if [ "$custom" = false ]; then
  case "$preset" in full) tools=scipy,ngspice,openscad,browser,desktop,gis,freecad,scilab,modelica,sysmlsim,orbit42,nos3 ;; minimal) tools= ;; esac
fi
case ",$tools," in *,,*) if [ -n "$tools" ]; then echo 'Empty tool group' >&2; exit 2; fi ;; esac
oldIFS=$IFS; IFS=,
for group in $tools; do
  case "$group" in modelica) modelica=1 ;;
    orbit42) orbit42=1 ;;
    nos3) nos3=1 ;;
    sysmlsim) sysmlsim=1 ;;
    scipy|ngspice|openscad|browser|desktop|gis|freecad|scilab) ;; *) echo "Unsupported tool: $group" >&2; exit 2 ;; esac
done
IFS=$oldIFS
tools=$(printf ",%s," "$tools" | sed 's/,modelica,/,/g; s/,orbit42,/,/g; s/,nos3,/,/g; s/,sysmlsim,/,/g; s/^,//; s/,$//')
docker info >/dev/null
docker compose version
mkdir -p deploy/local
for port in "${DAIDALIS_PORT:-4317}" "${DAIDALIS_DESKTOP_PORT:-6080}"; do
  case "$port" in ''|*[!0-9]*) echo 'Ports must be integers.' >&2; exit 2 ;; esac
  if [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ] || [ "$port" = 8080 ] || [ "$port" = 8081 ]; then
    echo 'Ports must be 1024–65535; 8080 and 8081 are reserved.' >&2; exit 2
  fi
done
if [ "${DAIDALIS_PORT:-4317}" = "${DAIDALIS_DESKTOP_PORT:-6080}" ]; then echo 'Web and desktop ports must differ.' >&2; exit 2; fi
project_name=${COMPOSE_PROJECT_NAME:-${saved_project:-daidalis}}
case "$project_name" in ''|*[!a-z0-9_-]*|[_-]*) echo 'Invalid Compose project name.' >&2; exit 2 ;; esac
printf 'DAIDALIS_TOOLS=%s\nDAIDALIS_TAG=%s\nDAIDALIS_MODELICA=%s\nDAIDALIS_SYML_SIM=%s\n' "$tools" "$preset" "$modelica" "$sysmlsim" > deploy/local/install.env
printf 'DAIDALIS_ORBIT42=%s\n' "$orbit42" >> deploy/local/install.env
printf 'COMPOSE_PROJECT_NAME=%s\n' "$project_name" >> deploy/local/install.env
model_env=${DAIDALIS_ENV_FILE:-}
if [ -z "$model_env" ]; then if [ -f .env ]; then model_env=.env; else model_env=.env.example; fi; fi
if [ ! -f "$model_env" ]; then echo 'DAIDALIS_ENV_FILE does not exist.' >&2; exit 2; fi
case "$model_env" in *\$*|*\#*|*\"*|*\'*) echo 'Environment file path contains unsupported characters.' >&2; exit 2 ;; esac
printf 'DAIDALIS_ENV_FILE=%s\n' "$model_env" >> deploy/local/install.env
desktop_profile=
case ",$tools," in *,desktop,*) desktop_profile=desktop ;; esac
printf 'COMPOSE_PROFILES=%s\n' "$desktop_profile" >> deploy/local/install.env
printf 'DAIDALIS_PORT=%s\nDAIDALIS_DESKTOP_PORT=%s\n' "${DAIDALIS_PORT:-4317}" "${DAIDALIS_DESKTOP_PORT:-6080}" >> deploy/local/install.env
if [ "$nos3" = 1 ]; then
  printf 'COMPOSE_FILE=compose.yaml:deploy/docker/compose.flight.yaml%s\n' "$migration_override" >> deploy/local/install.env
elif [ -n "$migration_override" ]; then
  printf 'COMPOSE_FILE=compose.yaml%s\n' "$migration_override" >> deploy/local/install.env
fi
echo "Building Daidalis preset=$preset tools=${tools:-none}. Existing project volumes will be retained."
echo 'Tools run inside the non-root Daidalis container. No Docker socket or separate daemon is required.'
docker compose --env-file deploy/local/install.env build daidalis
if [ "$nos3" = 1 ]; then
  docker build --build-arg "DAIDALIS_IMAGE=daidalis-app:$preset" -f deploy/docker/nos3-sdk.Dockerfile -t daidalis-nos3-sdk .
  docker build -f deploy/docker/nos3-native.Dockerfile -t daidalis-nos3-native-repro .
  docker build -f deploy/docker/flight.Dockerfile -t daidalis-flight:local .
  flight_image=$(docker image inspect daidalis-flight:local --format '{{.Id}}' | cut -c 8-19)
  printf 'DAIDALIS_FLIGHT_RUNTIME_TAG=%s\n' "$flight_image" >> deploy/local/install.env
else
  docker compose --env-file deploy/local/install.env -f compose.yaml -f deploy/docker/compose.flight.yaml stop flight 2>/dev/null || true
fi
if [ "$start" = true ]; then
  case ",$tools," in
    *,desktop,*) docker compose --env-file deploy/local/install.env --profile desktop up -d --wait ;;
    *) docker compose --env-file deploy/local/install.env stop desktop 2>/dev/null || true
       docker compose --env-file deploy/local/install.env up -d --wait ;;
  esac
  echo "Open http://127.0.0.1:${DAIDALIS_PORT:-4317} . Configure an API, Codex or Claude Agent in Daidalis."
fi
