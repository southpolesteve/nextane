#!/usr/bin/env bash
# Cleanup adapter for Next.js deploy tests. Adapted from Vinext (MIT).
set -euo pipefail

PID_FILE=".nextane-upstream-server.pid"
PORT_FILE=".nextane-upstream-server.port"

if [ -f "${PID_FILE}" ]; then
  PID="$(cat "${PID_FILE}")"
  rm -f "${PID_FILE}"
  kill -TERM "${PID}" >/dev/null 2>&1 || true
  sleep 1
  kill -KILL "${PID}" >/dev/null 2>&1 || true
fi

if [ -f "${PORT_FILE}" ]; then
  PORT="$(cat "${PORT_FILE}")"
  LISTENER_PID="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${LISTENER_PID}" ]; then
    kill -TERM ${LISTENER_PID} >/dev/null 2>&1 || true
    sleep 1
    kill -KILL ${LISTENER_PID} >/dev/null 2>&1 || true
  fi
fi
