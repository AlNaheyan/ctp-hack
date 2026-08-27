#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DERIVED_DATA_PATH="$SCRIPT_DIR/.build/DerivedData"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/Debug/boringNotch.app"
APP_PROCESS="boringNotch"
EXTENSION_PATH="$SCRIPT_DIR/extension"
API_PORT="${PORT:-3000}"
API_BASE_URL="${DISCUSSION_API_BASE_URL:-http://127.0.0.1:$API_PORT}"
BACKEND_HEALTH_URL="$API_BASE_URL/healthz"
BACKEND_LOG_PATH="$SCRIPT_DIR/.build/analysis-api.log"
BACKEND_PID_PATH="$SCRIPT_DIR/.build/analysis-api.pid"

export DISCUSSION_API_BASE_URL="$API_BASE_URL"

cd "$SCRIPT_DIR"

if [ ! -f "$EXTENSION_PATH/manifest.json" ]; then
  echo "Chrome extension manifest not found at: $EXTENSION_PATH/manifest.json" >&2
  exit 1
fi

if [ ! -d "/Applications/Google Chrome.app" ]; then
  echo "Google Chrome was not found in /Applications." >&2
  exit 1
fi

backend_is_ready() {
  curl --fail --silent --show-error --max-time 1 "$BACKEND_HEALTH_URL" >/dev/null 2>&1
}

is_repo_backend() {
  backend_command=$(ps -p "$1" -o command= 2>/dev/null || true)
  case "$backend_command" in
    *"$SCRIPT_DIR/backend/src/index.js"*) return 0 ;;
    *) return 1 ;;
  esac
}

stop_backend() {
  backend_to_stop="$1"
  if ! kill -0 "$backend_to_stop" 2>/dev/null; then
    return 0
  fi

  if ! is_repo_backend "$backend_to_stop"; then
    echo "Ignoring stale backend PID $backend_to_stop because it is not this repository's analysis API." >&2
    return 0
  fi

  echo "Stopping the previous analysis API (PID $backend_to_stop)..."
  kill -TERM "$backend_to_stop" 2>/dev/null || return 0

  attempts=0
  while [ "$attempts" -lt 30 ] && kill -0 "$backend_to_stop" 2>/dev/null; do
    sleep 0.1
    attempts=$((attempts + 1))
  done

  if kill -0 "$backend_to_stop" 2>/dev/null; then
    echo "The previous analysis API did not exit gracefully; force-stopping it..."
    kill -KILL "$backend_to_stop" 2>/dev/null || true
  fi
}

if ! command -v node >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "Node.js 20.10+ and curl are required to start and check the analysis API." >&2
  exit 1
fi

mkdir -p "$SCRIPT_DIR/.build"

# Stop the PID recorded by a previous run. Older versions did not write a PID
# file, so also inspect the configured port and stop only a matching repo API.
if [ -f "$BACKEND_PID_PATH" ]; then
  previous_backend_pid=$(cat "$BACKEND_PID_PATH")
  case "$previous_backend_pid" in
    ''|*[!0-9]*) echo "Ignoring invalid backend PID file: $BACKEND_PID_PATH" >&2 ;;
    *) stop_backend "$previous_backend_pid" ;;
  esac
fi
rm -f "$BACKEND_PID_PATH"

if command -v lsof >/dev/null 2>&1; then
  for listener_pid in $(lsof -nP -tiTCP:"$API_PORT" -sTCP:LISTEN 2>/dev/null || true); do
    if is_repo_backend "$listener_pid"; then
      stop_backend "$listener_pid"
    fi
  done
fi

: > "$BACKEND_LOG_PATH"

echo "Starting the analysis API at ${API_BASE_URL}..."
nohup env PORT="$API_PORT" node "$SCRIPT_DIR/backend/src/index.js" >"$BACKEND_LOG_PATH" 2>&1 &
backend_pid=$!
printf '%s\n' "$backend_pid" > "$BACKEND_PID_PATH"

attempts=0
while [ "$attempts" -lt 100 ]; do
  if backend_is_ready; then
    break
  fi
  if ! kill -0 "$backend_pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
  attempts=$((attempts + 1))
done

if ! backend_is_ready; then
  rm -f "$BACKEND_PID_PATH"
  echo "Analysis API failed to become ready. Recent log output:" >&2
  tail -n 40 "$BACKEND_LOG_PATH" >&2
  exit 1
fi

echo "Analysis API ready (PID $backend_pid; log: $BACKEND_LOG_PATH)"

echo "Finding the unpacked extension in the normal Chrome profile..."
if ! extension_id=$(node "$SCRIPT_DIR/scripts/find-chrome-extension-id.mjs" "$EXTENSION_PATH"); then
  echo "Unable to register the native messaging host." >&2
  exit 1
fi

echo "Registering the native messaging host for extension $extension_id..."
npm run native:register -- "$extension_id"

echo "Building boringNotch..."
xcodebuild \
  -quiet \
  -project boringNotch.xcodeproj \
  -scheme boringNotch \
  -configuration Debug \
  -destination "generic/platform=macOS" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  build

if [ ! -d "$APP_PATH" ]; then
  echo "Build succeeded, but the app was not found at: $APP_PATH" >&2
  exit 1
fi

# Replace only running instances whose executable name exactly matches this app.
if pgrep -x "$APP_PROCESS" >/dev/null; then
  echo "Stopping the previous boringNotch instance..."
  pkill -TERM -x "$APP_PROCESS"

  attempts=0
  while [ "$attempts" -lt 30 ]; do
    if ! pgrep -x "$APP_PROCESS" >/dev/null; then
      break
    fi
    sleep 0.1
    attempts=$((attempts + 1))
  done

  if pgrep -x "$APP_PROCESS" >/dev/null; then
    echo "The previous instance did not exit gracefully; force-stopping it..."
    pkill -KILL -x "$APP_PROCESS"

    attempts=0
    while [ "$attempts" -lt 20 ]; do
      if ! pgrep -x "$APP_PROCESS" >/dev/null; then
        break
      fi
      sleep 0.1
      attempts=$((attempts + 1))
    done

    if pgrep -x "$APP_PROCESS" >/dev/null; then
      echo "Unable to stop the previous boringNotch instance." >&2
      exit 1
    fi
  fi
fi

echo "Launching $APP_PATH"
open -n "$APP_PATH"

echo "Opening YouTube in the normal Google Chrome profile..."
echo "Extension source: $EXTENSION_PATH (reload it in chrome://extensions after code changes)"
open -a "Google Chrome" "https://www.youtube.com/"
