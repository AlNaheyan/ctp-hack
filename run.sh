#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DERIVED_DATA_PATH="$SCRIPT_DIR/.build/DerivedData"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/Debug/boringNotch.app"
APP_PROCESS="boringNotch"
EXTENSION_PATH="$SCRIPT_DIR/extension"
CHROME_PROFILE_PATH="$SCRIPT_DIR/.build/ChromeExtensionProfile"
CHROME_BINARY="${GOOGLE_CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
API_BASE_URL="${DISCUSSION_API_BASE_URL:-http://127.0.0.1:${PORT:-8787}}"
BACKEND_HEALTH_URL="$API_BASE_URL/healthz"
BACKEND_LOG_PATH="$SCRIPT_DIR/.build/analysis-api.log"

export DISCUSSION_API_BASE_URL="$API_BASE_URL"

cd "$SCRIPT_DIR"

if [ ! -f "$EXTENSION_PATH/manifest.json" ]; then
  echo "Chrome extension manifest not found at: $EXTENSION_PATH/manifest.json" >&2
  exit 1
fi

if [ ! -x "$CHROME_BINARY" ]; then
  echo "Google Chrome was not found at: $CHROME_BINARY" >&2
  echo "Set GOOGLE_CHROME_PATH to the Google Chrome executable and try again." >&2
  exit 1
fi

backend_is_ready() {
  curl --fail --silent --show-error --max-time 1 "$BACKEND_HEALTH_URL" >/dev/null 2>&1
}

if backend_is_ready; then
  echo "Analysis API is already running at $API_BASE_URL"
else
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "Node.js 20.10+ and npm are required to start the analysis API." >&2
    exit 1
  fi

  mkdir -p "$SCRIPT_DIR/.build"
  : > "$BACKEND_LOG_PATH"

  echo "Starting the analysis API at $API_BASE_URL…"
  nohup npm run dev >"$BACKEND_LOG_PATH" 2>&1 &
  backend_pid=$!

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
    echo "Analysis API failed to become ready. Recent log output:" >&2
    tail -n 40 "$BACKEND_LOG_PATH" >&2
    exit 1
  fi

  echo "Analysis API ready (PID $backend_pid; log: $BACKEND_LOG_PATH)"
fi

echo "Building boringNotch…"
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
  echo "Stopping the previous boringNotch instance…"
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
    echo "The previous instance did not exit gracefully; force-stopping it…"
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

# A dedicated profile keeps development flags and extension state isolated from
# the user's normal Chrome profile. Reusing it also avoids first-run setup on
# every app rebuild.
mkdir -p "$CHROME_PROFILE_PATH"

echo "Launching Google Chrome with the unpacked discussion extension…"
"$CHROME_BINARY" \
  --user-data-dir="$CHROME_PROFILE_PATH" \
  --load-extension="$EXTENSION_PATH" \
  --no-first-run \
  --no-default-browser-check \
  "https://www.youtube.com/" \
  >/dev/null 2>&1 &
