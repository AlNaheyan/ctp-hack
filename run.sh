#!/bin/sh

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DERIVED_DATA_PATH="$SCRIPT_DIR/.build/DerivedData"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/Debug/boringNotch.app"
APP_PROCESS="boringNotch"
EXTENSION_PATH="$SCRIPT_DIR/extension"
API_PORT="${PORT:-3000}"
API_HOST="${DISCUSSION_API_HOST:-127.0.0.1}"
API_BASE_URL="${DISCUSSION_API_BASE_URL:-http://$API_HOST:$API_PORT}"

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

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 20.10+ and npm are required to register the Chrome extension bridge." >&2
  exit 1
fi

mkdir -p "$SCRIPT_DIR/.build"

echo "Using the separately managed analysis API at $API_BASE_URL"
echo "Start it in another terminal with: HOST=$API_HOST PORT=$API_PORT npm run api"

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
