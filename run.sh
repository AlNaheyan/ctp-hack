#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
DERIVED_DATA_PATH="$SCRIPT_DIR/.build/DerivedData"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/Debug/boringNotch.app"
APP_PROCESS="boringNotch"

cd "$SCRIPT_DIR"

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

if [[ ! -d "$APP_PATH" ]]; then
  echo "Build succeeded, but the app was not found at: $APP_PATH" >&2
  exit 1
fi

# Replace only running instances whose executable name exactly matches this app.
if pgrep -x "$APP_PROCESS" >/dev/null; then
  echo "Stopping the previous boringNotch instance…"
  pkill -TERM -x "$APP_PROCESS"

  for _ in {1..30}; do
    if ! pgrep -x "$APP_PROCESS" >/dev/null; then
      break
    fi
    sleep 0.1
  done

  if pgrep -x "$APP_PROCESS" >/dev/null; then
    echo "The previous instance did not exit gracefully; force-stopping it…"
    pkill -KILL -x "$APP_PROCESS"

    for _ in {1..20}; do
      if ! pgrep -x "$APP_PROCESS" >/dev/null; then
        break
      fi
      sleep 0.1
    done

    if pgrep -x "$APP_PROCESS" >/dev/null; then
      echo "Unable to stop the previous boringNotch instance." >&2
      exit 1
    fi
  fi
fi

echo "Launching $APP_PATH"
open -n "$APP_PATH"
