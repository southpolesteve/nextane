#!/usr/bin/env bash
# Log adapter for Next.js deploy tests. Adapted from Vinext (MIT).
set -euo pipefail

for log_file in .nextane-upstream-build.log .nextane-upstream-server.log; do
  if [ -f "${log_file}" ]; then
    echo "=== ${log_file} ==="
    cat "${log_file}"
  fi
done
