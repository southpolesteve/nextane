#!/usr/bin/env bash
# Custom deployment adapter for the Next.js e2e deploy-test runner.
#
# The runner invokes this script from an isolated fixture directory and expects
# exactly one deployment URL on stdout. Diagnostics are kept in local log files.
#
# Structure and lifecycle adapted from Vinext's scripts/e2e-deploy.sh (MIT).
# See scripts/upstream/README.md for provenance.
set -euo pipefail

NEXTANE_DIR="${NEXTANE_DIR:-${ADAPTER_DIR:-}}"
if [ -z "${NEXTANE_DIR}" ]; then
  echo "Set NEXTANE_DIR or ADAPTER_DIR to the Nextane repository" >&2
  exit 1
fi
NEXTANE_DIR="$(cd "${NEXTANE_DIR}" && pwd)"

BUILD_LOG=".nextane-upstream-build.log"
SERVER_LOG=".nextane-upstream-server.log"
PID_FILE=".nextane-upstream-server.pid"
PORT_FILE=".nextane-upstream-server.port"
READY=0

find_free_port() {
  node -e '
    const net = require("node:net");
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") process.exit(1);
      console.log(address.port);
      server.close();
    });
  '
}

stop_server() {
  if [ -f "${PID_FILE}" ]; then
    local pid
    pid="$(cat "${PID_FILE}")"
    kill -TERM "${pid}" >/dev/null 2>&1 || true
    sleep 1
    kill -KILL "${pid}" >/dev/null 2>&1 || true
  fi

  if [ -f "${PORT_FILE}" ]; then
    local port listener_pid
    port="$(cat "${PORT_FILE}")"
    listener_pid="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "${listener_pid}" ]; then
      kill -TERM ${listener_pid} >/dev/null 2>&1 || true
      sleep 1
      kill -KILL ${listener_pid} >/dev/null 2>&1 || true
    fi
  fi
}

on_exit() {
  if [ "${READY}" = "1" ]; then
    return
  fi
  stop_server
  {
    echo
    echo "=== Nextane upstream deploy failure ==="
    if [ -f "${BUILD_LOG}" ]; then
      echo "--- ${BUILD_LOG} ---"
      tail -100 "${BUILD_LOG}" || true
    fi
    if [ -f "${SERVER_LOG}" ]; then
      echo "--- ${SERVER_LOG} ---"
      tail -80 "${SERVER_LOG}" || true
    fi
    echo "=== end failure details ==="
  } >&2
}
trap on_exit EXIT

if [ ! -x "${NEXTANE_DIR}/node_modules/.bin/vite" ]; then
  echo "Nextane dependencies are not installed at ${NEXTANE_DIR}" >&2
  exit 1
fi
if [ ! -x "${NEXTANE_DIR}/node_modules/.bin/wrangler" ]; then
  echo "Wrangler is not installed at ${NEXTANE_DIR}" >&2
  exit 1
fi

: > "${BUILD_LOG}"
: > "${SERVER_LOG}"

node "${NEXTANE_DIR}/scripts/upstream/adapt-fixture.mjs" \
  --root "$(pwd)" \
  --nextane-root "${NEXTANE_DIR}" >> "${BUILD_LOG}" 2>&1

export CI=1
export NO_COLOR=1
export FORCE_COLOR=0

node "${NEXTANE_DIR}/node_modules/vite/bin/vite.js" \
  build \
  --config nextane-upstream.vite.config.mjs >> "${BUILD_LOG}" 2>&1

GENERATED_CONFIG="$(
  find dist -mindepth 2 -maxdepth 3 -type f -name wrangler.json -print | sort | head -1
)"
if [ -z "${GENERATED_CONFIG}" ]; then
  echo "Cloudflare Vite build did not emit a Wrangler configuration" >&2
  exit 1
fi

PORT="$(find_free_port)"
DEPLOYMENT_URL="http://127.0.0.1:${PORT}"
DEPLOYMENT_ID="${NEXT_DEPLOYMENT_ID:-nextane-local-${PORT}}"
echo "${PORT}" > "${PORT_FILE}"

{
  echo "BUILD_ID: development"
  echo "DEPLOYMENT_ID: ${DEPLOYMENT_ID}"
  echo "IMMUTABLE_ASSET_TOKEN: undefined"
  echo "NEXT_SUPPORTS_IMMUTABLE_ASSETS: 0"
  echo "NEXTANE_PROFILE: $(node -e 'console.log(require("./.nextane-upstream-adaptation.json").profile)')"
  echo "NEXTANE_WRANGLER_CONFIG: ${GENERATED_CONFIG}"
} >> "${BUILD_LOG}"

node "${NEXTANE_DIR}/node_modules/wrangler/bin/wrangler.js" \
  dev \
  --config "${GENERATED_CONFIG}" \
  --port "${PORT}" \
  --ip 127.0.0.1 \
  --inspector-port 0 \
  --log-level warn \
  --show-interactive-dev-session false >> "${SERVER_LOG}" 2>&1 &
SERVER_PID="$!"
echo "${SERVER_PID}" > "${PID_FILE}"

for _ in $(seq 1 120); do
  if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    echo "Wrangler exited before the fixture became ready" >&2
    exit 1
  fi
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' "${DEPLOYMENT_URL}" || true)"
  if [ -n "${STATUS}" ] && [ "${STATUS}" != "000" ]; then
    READY=1
    while IFS= read -r warmup_path; do
      if [ -n "${warmup_path}" ]; then
        curl -s -o /dev/null "${DEPLOYMENT_URL}${warmup_path}"
      fi
    done < <(
      node -e '
        const report = require("./.nextane-upstream-adaptation.json")
        for (const pathname of report.warmupPaths ?? []) console.log(pathname)
      '
    )
    echo "${DEPLOYMENT_URL}"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for ${DEPLOYMENT_URL}" >&2
exit 1
