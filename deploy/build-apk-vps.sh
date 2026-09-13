#!/usr/bin/env bash
#
# Build the Android APK on the VPS (no Expo/EAS), then publish it for download at
# https://pioassets.com/downloads/techpioasset.apk.
#
# Prerequisites (one-time, already installed on this server — see /opt/android-setup.sh):
#   - JDK 17, Node 22 in /opt/node22, pnpm, Android SDK in /opt/android-sdk
#     (platform-35, build-tools 35.0.0, ndk 26.1.10909125, cmake 3.22.1)
#   - env in /opt/android-build.env
#
# Re-run this whenever mobile code changes to produce a fresh APK.
set -euo pipefail

source /opt/android-build.env
APP_DIR="${APP_DIR:-/opt/techpioasset}"
PUBLISH_TO="${PUBLISH_TO:-/var/www/piotask-downloads/techpioasset.apk}"
API_URL="${EXPO_PUBLIC_API_URL:-https://pioassets.com}"

SDK_DIR="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/android-sdk}}"
APP_JSON="$APP_DIR/apps/mobile/app.json"

# ── versionCode: derived, never remembered ───────────────────────────────────
#
# Android refuses to install an APK whose versionCode is lower than the one on
# the device, and gives you no way to tell two builds apart if it never moves.
# It sat at 1 for every build because app.json simply never declared it.
#
# So the number is derived at build time from the APK that is actually
# published - the only thing that reflects what people already have installed -
# and the value in app.json acts as a floor. Nothing has to be remembered, and
# a build can never publish a code that Android would reject as a downgrade.
#
# versionName is deliberately NOT touched: "0.3.0 vs 0.2.1" is a judgement
# about the size of a change, which belongs to a person, not a script.
published_version_code() {
  local bt apk
  apk="$PUBLISH_TO"
  [ -f "$apk" ] || { echo 0; return; }
  bt="$(ls -d "$SDK_DIR"/build-tools/* 2>/dev/null | sort -V | tail -1)"
  [ -n "$bt" ] || { echo 0; return; }
  "$bt/aapt" dump badging "$apk" 2>/dev/null \
    | sed -n "s/.*versionCode='\([0-9]\+\)'.*/\1/p" | head -1 | grep -E '^[0-9]+$' || echo 0
}

declared_version_code() {
  node -e "const c=require('$APP_JSON').expo;process.stdout.write(String(c.android?.versionCode ?? 1))" 2>/dev/null || echo 1
}

PUBLISHED_CODE="$(published_version_code)"
DECLARED_CODE="$(declared_version_code)"
NEXT_CODE=$(( PUBLISHED_CODE + 1 ))
# `[ ... ] && x=y` would return non-zero when the test is false, and `set -e`
# would kill the build over an ordinary "no, keep the first value".
if [ "$DECLARED_CODE" -gt "$NEXT_CODE" ]; then NEXT_CODE="$DECLARED_CODE"; fi
VERSION_NAME="$(node -e "process.stdout.write(require('$APP_JSON').expo.version)")"

echo "[0/4] version: $VERSION_NAME (code $NEXT_CODE; published was $PUBLISHED_CODE, app.json floor $DECLARED_CODE)"

# app.json is the input prebuild reads, so the derived code goes in there for
# the build and comes straight back out afterwards - the checkout is left
# exactly as git has it, so the next `git pull` cannot conflict.
APP_JSON_BACKUP="$(mktemp)"
cp "$APP_JSON" "$APP_JSON_BACKUP"
restore_sources() {
  cp "$APP_JSON_BACKUP" "$APP_JSON"
  rm -f "$APP_JSON_BACKUP"
  rm -f "$APP_DIR/apps/mobile/google-services.json"
  # `expo prebuild` also rewrites package.json's android/ios scripts to
  # `expo run:*`. That is a TRACKED file, so leaving it modified is what would
  # eventually make `git pull` on this box fail. (android/ is generated and
  # untracked, so it needs no restoring - it can never conflict.)
  git -C "$APP_DIR" checkout -- apps/mobile/package.json 2>/dev/null || true
}
trap restore_sources EXIT

# ── Firebase: push only works in a build that carries google-services.json ────
#
# It is read from the server rather than committed, and wired into app.json for
# this build only, the same way the versionCode is. Without it the build still
# succeeds - it simply cannot receive push - so its absence is announced loudly
# instead of failing the build.
FIREBASE_CONFIG="${FIREBASE_CONFIG:-/etc/techpioasset/firebase/google-services.json}"
USE_FIREBASE=false
if [ -f "$FIREBASE_CONFIG" ]; then
  cp "$FIREBASE_CONFIG" "$APP_DIR/apps/mobile/google-services.json"
  USE_FIREBASE=true
  echo "[0/4] firebase: using $FIREBASE_CONFIG"
else
  echo "[0/4] WARNING: no $FIREBASE_CONFIG - this APK will NOT receive push notifications"
fi

node -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync('$APP_JSON','utf8'));
j.expo.android = j.expo.android || {};
j.expo.android.versionCode = $NEXT_CODE;
if ($USE_FIREBASE) j.expo.android.googleServicesFile = './google-services.json';
fs.writeFileSync('$APP_JSON', JSON.stringify(j,null,2)+'\n');
"

cd "$APP_DIR"
echo "[1/4] install workspace deps + build mobile's workspace packages"
pnpm install --frozen-lockfile
pnpm --filter "@techpioasset/mobile^..." build   # domain/contracts/ui-tokens -> dist

echo "[2/4] expo prebuild (regenerate android/)"
cd "$APP_DIR/apps/mobile"
export EXPO_NO_TELEMETRY=1
pnpm exec expo prebuild --platform android --no-install

echo "[3/4] gradle assembleRelease (arm only; API baked = $API_URL)"
export EXPO_PUBLIC_API_URL="$API_URL"
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --no-daemon

echo "[4/4] publish APK"
APK="$(find "$APP_DIR/apps/mobile/android/app/build/outputs/apk/release" -name '*.apk' | head -1)"
mkdir -p "$(dirname "$PUBLISH_TO")"
cp "$APK" "$PUBLISH_TO"
chmod 644 "$PUBLISH_TO"
echo "done: $APK -> $PUBLISH_TO ($(du -h "$PUBLISH_TO" | cut -f1))"
echo "published $VERSION_NAME (versionCode $NEXT_CODE, push: $USE_FIREBASE)"
