#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -version
python3 scripts/generate-ios-project.py
swift run PhotoCoreTests
if [[ -n "${IOS_TEST_DEVICE:-}" ]]; then
  test_options=(-parallel-testing-enabled NO)
  if [[ "${IOS_NATIVE_ONLY:-0}" == 1 ]]; then
    test_options+=(-only-testing:PhotoSelectorTests)
  fi
  xcodebuild -project ios/PhotoSelector.xcodeproj -scheme PhotoSelector \
    -destination "platform=iOS Simulator,id=$IOS_TEST_DEVICE" \
    -derivedDataPath .local/ios-build CODE_SIGNING_ALLOWED=NO ARCHS="$(uname -m)" "${test_options[@]}" test
else
  xcodebuild -project ios/PhotoSelector.xcodeproj -scheme PhotoSelector \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath .local/ios-build CODE_SIGNING_ALLOWED=NO ARCHS="$(uname -m)" build-for-testing
  echo 'Build completed. Set IOS_TEST_DEVICE to a simulator UDID to run the native/UI tests.'
fi
