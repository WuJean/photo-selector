#!/bin/bash
# Install the freshly built app on a simulator, launch it with deterministic
# fixture data and capture a screenshot.
#
#   scripts/shot-ios.sh <simulator-udid> <output.png> [seed|empty]
#
# The UI test suite remains the authoritative check; this helper is for quick
# visual iteration while changing a screen.
set -euo pipefail
cd "$(dirname "$0")/.."
UDID="$1"; OUT="$2"; MODE="${3:-seed}"
APP=".local/dd/Build/Products/Debug-iphonesimulator/PhotoSelector.app"
BUNDLE="com.wujean.photoselector"
[[ -d "$APP" ]] || { echo "Build first: xcodebuild -project ios/PhotoSelector.xcodeproj -scheme PhotoSelector -destination 'platform=iOS Simulator,name=iPhone 18 Pro' build" >&2; exit 1; }
xcrun simctl install "$UDID" "$APP"
EMPTY=0
[[ "$MODE" == empty ]] && EMPTY=1
SIMCTL_CHILD_PHOTO_SELECTOR_UI_TEST="shot-$RANDOM-$RANDOM" SIMCTL_CHILD_PHOTO_SELECTOR_UI_EMPTY="$EMPTY" \
  xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
sleep 4
mkdir -p "$(dirname "$OUT")"
xcrun simctl io "$UDID" screenshot "$OUT" >/dev/null
echo "$OUT"
