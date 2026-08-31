#!/usr/bin/env bash
# Keep the installed Luca development app's local relay alive independently of
# the terminal that rebuilt the app. This preserves the existing database and
# only exposes the relay on this Mac's loopback interface.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMUX_SESSION="${LUCA_DEV_RELAY_SESSION:-luca-dev-relay}"
RELAY_LOG="${LUCA_DEV_RELAY_LOG:-/tmp/luca-dev-relay.log}"
RELAY_BINARY="${REPO_ROOT}/target/debug/buzz-relay"
READINESS_URL="http://127.0.0.1:8080/_readiness"
FORCE_RESTART="${LUCA_DEV_RELAY_RESTART:-0}"

relay_is_ready() {
  curl --silent --fail --max-time 1 "${READINESS_URL}" >/dev/null 2>&1
}

if relay_is_ready && [[ "${FORCE_RESTART}" != "1" ]]; then
  echo "Luca dev relay is already ready at ws://localhost:3000"
  exit 0
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required to keep the Luca dev relay alive after this terminal exits." >&2
  exit 1
fi

if [[ "${FORCE_RESTART}" == "1" ]]; then
  relay_pids=$(lsof -nP -t -iTCP:3000 -sTCP:LISTEN 2>/dev/null | sort -u || true)
  for relay_pid in ${relay_pids}; do
    relay_command=$(ps -p "${relay_pid}" -o command= 2>/dev/null || true)
    case "${relay_command}" in
      *buzz-relay*) kill -TERM "${relay_pid}" ;;
      *)
        echo "Port 3000 belongs to an unexpected process; refusing to replace it:" >&2
        echo "${relay_command}" >&2
        exit 1
        ;;
    esac
  done
  for _ in $(seq 1 40); do
    if ! lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

if command -v lsof >/dev/null 2>&1 &&
  lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3000 is already in use, but its relay is not ready; refusing to replace it." >&2
  lsof -nP -iTCP:3000 -sTCP:LISTEN >&2 || true
  exit 1
fi

if [[ ! -x "${RELAY_BINARY}" ]]; then
  echo "Missing relay binary: ${RELAY_BINARY}" >&2
  echo "Build it first with: cargo build -p buzz-relay" >&2
  exit 1
fi

cd "${REPO_ROOT}"
docker compose up -d postgres redis minio minio-init

for container in buzz-postgres buzz-redis buzz-minio; do
  healthy=false
  for _ in $(seq 1 60); do
    status=$(docker inspect --format='{{.State.Health.Status}}' "${container}" 2>/dev/null || true)
    if [[ "${status}" == "healthy" ]]; then
      healthy=true
      break
    fi
    sleep 1
  done
  if [[ "${healthy}" != "true" ]]; then
    echo "${container} did not become healthy." >&2
    exit 1
  fi
done

# A named session left without a listener belongs to an interrupted prior
# launch of this helper. Replace only that narrowly scoped session.
tmux kill-session -t "${TMUX_SESSION}" 2>/dev/null || true

printf -v relay_command \
  "cd %q && exec env DATABASE_URL=%q REDIS_URL=%q RELAY_URL=%q BUZZ_BIND_ADDR=%q BUZZ_AUTO_MIGRATE=1 BUZZ_RECONCILE_CHANNELS=true BUZZ_GIT_PROBE_WRITERS=8 BUZZ_GIT_PROBE_ROUNDS=2 %q >> %q 2>&1" \
  "${REPO_ROOT}" \
  "postgres://buzz:buzz_dev@localhost:5432/buzz" \
  "redis://localhost:6379" \
  "ws://localhost:3000" \
  "127.0.0.1:3000" \
  "${RELAY_BINARY}" \
  "${RELAY_LOG}"

tmux new-session -d -s "${TMUX_SESSION}" "${relay_command}"

for _ in $(seq 1 60); do
  if relay_is_ready; then
    echo "Luca dev relay is ready at ws://localhost:3000"
    echo "Relay log: ${RELAY_LOG}"
    exit 0
  fi
  if ! tmux has-session -t "${TMUX_SESSION}" 2>/dev/null; then
    echo "Luca dev relay exited during startup. See ${RELAY_LOG}" >&2
    exit 1
  fi
  sleep 1
done

echo "Luca dev relay did not become ready within 60 seconds. See ${RELAY_LOG}" >&2
exit 1
