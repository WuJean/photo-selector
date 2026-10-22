#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to your registered developer team ID}"
python3 scripts/generate-ios-project.py
xcodebuild -project ios/PhotoSelector.xcodeproj -scheme PhotoSelector \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath .local/PhotoSelector.xcarchive \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" -allowProvisioningUpdates archive
printf '%s\n' 'Archive created: .local/PhotoSelector.xcarchive. Validate and distribute through Xcode Organizer.'
