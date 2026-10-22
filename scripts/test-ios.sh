#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -version
python3 scripts/generate-ios-project.py
swift run PhotoCoreTests
if [[ -n "${IOS_TEST_DEVICE:-}" ]]; then
  xcodebuild -project ios/PhotoSelector.xcodeproj -scheme PhotoSelector \
    -destination "platform=iOS Simulator,id=$IOS_TEST_DEVICE" \
    -derivedDataPath .local/ios-build CODE_SIGNING_ALLOWED=NO test
else
  xcodebuild -project ios/PhotoSelector.xcodeproj -scheme PhotoSelector \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath .local/ios-build CODE_SIGNING_ALLOWED=NO build-for-testing
  echo 'Build completed. Set IOS_TEST_DEVICE to a simulator UDID to run the native/UI tests.'
fi
