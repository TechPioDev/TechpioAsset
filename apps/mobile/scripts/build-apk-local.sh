#!/usr/bin/env bash
#
# Build a release APK on this Windows machine, without Expo Application Services.
#
# Run from Git Bash:
#     bash apps/mobile/scripts/build-apk-local.sh
#
# Output: apps/mobile/build/app-release.apk (copied there from wherever Gradle
# ran - see SHORT CHECKOUT below).
#
# The APK is signed with the Android *debug* key, because that is what
# `expo prebuild` writes into android/app/build.gradle. It installs by sideload
# and is fine for internal testing, but it is not a distribution key: Play Store
# uploads and in-place upgrades from a differently-signed build both need a real
# keystore. Creating one requires a password that only the owner should choose.
#
# ---------------------------------------------------------------------------
# Why each setting below is here - all of these were failures, not precautions.
# ---------------------------------------------------------------------------
#
# JAVA_HOME / ANDROID_HOME
#   JAVA_HOME is taken from the environment, else the first JDK that exists:
#   C:\dev\jdk-17, Android Studio's bundled one, then Unity's (which no longer
#   ships its Android module on this machine - it vanished between August and
#   November 2026 and took the SDK platforms and NDK with it). ANDROID_HOME is
#   C:\Android\sdk, a writable SDK assembled from pieces - see SDK LAYOUT. It
#   must stay writable and space-free (see CMAKE below).
#
# SHORT CHECKOUT  (the 260-character limit, again)
#   Since the repo moved to E:\TechPio-Data\TechpioAsset the arm64 prefab paths
#   inside the pnpm store reach 257 characters, and ninja reports the fbjni
#   config it just wrote as missing and loops until "manifest 'build.ninja'
#   still dirty after 100 tries". Clearing .cxx does not help; the path is
#   simply too long. Enabling long paths is a system setting that is the
#   owner's to change, so instead the build runs from a git worktree at a short
#   real path (SHORT_ROOT, default E:\ta) whenever the checkout path is longer
#   than MAX_ROOT_LEN characters. The worktree is moved to the current HEAD,
#   installed from the pnpm store, and this same script re-runs itself inside
#   it. It therefore builds what is COMMITTED - commit first. (subst drives
#   and junctions do not work: node resolves the real path and React Native's
#   Gradle plugin refuses to relativize across the two roots.)
#
# TMP / TEMP  (instead of JAVA_TOOL_OPTIONS)
#   Gradle's daemon cannot open its AF_UNIX socket under this machine's default
#   temp directory; it dies with "Unable to establish loopback connection". The
#   usual fix is JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Temp - but do
#   NOT use it here. JAVA_TOOL_OPTIONS is inherited by every child JVM, and each
#   one prints "Picked up JAVA_TOOL_OPTIONS: ..." to stderr. The Android plugin
#   treats *any* prefab stderr as failure and reports it as
#   "[CXX1210] No compatible library found" - an error about neither prefab nor
#   libraries, on a tool that exited 0. Setting TMP/TEMP moves the socket without
#   the banner. (GRADLE_OPTS and org.gradle.jvmargs both fail differently: they
#   fork a single-use daemon that then dies.)
#
# EXPO_NO_METRO_WORKSPACE_ROOT
#   Expo defaults Metro's server root to the *workspace* root in a monorepo,
#   while React Native's Gradle plugin writes --entry-file relative to
#   apps/mobile. In a pnpm workspace the entry resolves through ../../ into the
#   store, so the two disagree and the bundle step dies with "Unable to resolve
#   module ./../../node_modules/.../expo-router/entry.js". This pins the server
#   root to apps/mobile, matching what Gradle passes.
#
# reactNativeArchitectures=arm64-v8a
#   armeabi-v7a hits the same 260-character limit even from the short checkout
#   (ninja stats its prefab output via "armeabi-v7a\..\"). arm64-v8a covers
#   essentially every Android device sold since about 2017; a universal APK
#   needs long-path support enabled on the machine.
#
# android.buildToolsVersion=34.0.0
#   The Expo modules ask for build-tools 34 regardless of the root project's
#   setting, and Gradle will not install it for you without accepting the SDK
#   licence agreements.
#
# ---------------------------------------------------------------------------
# SDK LAYOUT - one-time setup, already done on this machine (re-pointed 10 Nov 2026)
# ---------------------------------------------------------------------------
#   C:\Android\sdk\platforms\android-35,-36   junctions into %LOCALAPPDATA%\Android\Sdk
#   C:\Android\sdk\platform-tools             junction into %LOCALAPPDATA%\Android\Sdk
#   C:\Android\sdk\build-tools\35.0.0,36.0.0  junctions into %LOCALAPPDATA%\Android\Sdk
#   C:\Android\sdk\build-tools\34.0.0         real copy (dl.google.com build-tools_r34)
#   C:\Android\sdk\ndk\26.1.10909125          real copy (dl.google.com android-ndk-r26b)
#   C:\Android\sdk\cmake\3.22.1               real COPY, not a junction
#
#   %LOCALAPPDATA%\Android\Sdk is the owner's Android Studio SDK (licences
#   accepted there, by them). It has no NDK or CMake, which is why those stay
#   as real copies here. Unpacked packages are not licence-checked, so Gradle
#   never has to install anything.
#
#   CMake must be a real copy. Through a junction, CMake resolves its own module
#   paths back to "C:\Program Files\Unity\...", and ninja cannot match dependency
#   paths containing an escaped space - the same "build.ninja still dirty" loop.
#
set -euo pipefail

# When re-run inside the short worktree, MOBILE_DIR points there, not at the
# directory this script file lives in.
MOBILE_DIR="${MOBILE_DIR_OVERRIDE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REPO_ROOT="$(cd "$MOBILE_DIR/../.." && pwd)"

if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in \
    /c/dev/jdk-17 \
    "/c/Program Files/Android/Android Studio/jbr" \
    "/c/Program Files/Unity/Hub/Editor/6000.3.20f1/Editor/Data/PlaybackEngines/AndroidPlayer/OpenJDK"; do
    if [ -x "$candidate/bin/java.exe" ]; then
      JAVA_HOME="$(cygpath -m "$candidate")"
      break
    fi
  done
fi
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$(cygpath -u "$JAVA_HOME")/bin/java.exe" ]; then
  echo "No JDK found. Set JAVA_HOME to a JDK 17 (C:\\dev\\jdk-17 or Android Studio's jbr)." >&2
  exit 1
fi
: "${ANDROID_HOME:=C:/Android/sdk}"
: "${SHORT_ROOT:=/e/ta}"
: "${MAX_ROOT_LEN:=20}"
: "${GRADLE_BIN:=/c/Gradle/gradle-8.10.2/bin/gradle}"
: "${ANDROID_ABI:=arm64-v8a}"

export JAVA_HOME
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export TMP='C:\Temp'
export TEMP='C:\Temp'
export EXPO_NO_METRO_WORKSPACE_ROOT=1
# Must not be set - see the note above.
unset JAVA_TOOL_OPTIONS GRADLE_OPTS

mkdir -p /c/Temp

# SHORT CHECKOUT - see the note above. Builds the committed HEAD.
WIN_ROOT="$(cygpath -w "$REPO_ROOT")"
if [ "${#WIN_ROOT}" -gt "$MAX_ROOT_LEN" ] && [ -z "${TECHPIO_IN_SHORT_ROOT:-}" ]; then
  HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  echo "==> checkout path is ${#WIN_ROOT} characters; building from the short worktree $SHORT_ROOT at ${HEAD_SHA:0:7}"
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain -- apps/mobile packages)" ]; then
    echo "    note: uncommitted changes under apps/mobile or packages are NOT in this build"
  fi
  if [ ! -e "$SHORT_ROOT/.git" ]; then
    git -C "$REPO_ROOT" worktree add --detach "$SHORT_ROOT" "$HEAD_SHA"
  else
    git -C "$SHORT_ROOT" checkout --quiet --detach "$HEAD_SHA"
  fi
  ( cd "$SHORT_ROOT" && { pnpm install --frozen-lockfile --offline >/dev/null 2>&1 || pnpm install --frozen-lockfile; } )
  TECHPIO_IN_SHORT_ROOT=1 MOBILE_DIR_OVERRIDE="$SHORT_ROOT/apps/mobile" APK_OUT_DIR="${APK_OUT_DIR:-$MOBILE_DIR/build}" \
    exec bash "${BASH_SOURCE[0]}"
fi

# The app imports @techpioasset/domain, contracts and ui-tokens from their
# dist/ folders, which a fresh checkout does not have.
echo "==> building the shared packages"
( cd "$REPO_ROOT" && pnpm turbo run build --filter='./packages/*' >/dev/null )

if [ ! -d "$MOBILE_DIR/android" ]; then
  echo "==> android/ is not present; generating it with expo prebuild"
  ( cd "$MOBILE_DIR" && npx expo prebuild --platform android --no-install )
  # prebuild rewrites the android/ios package.json scripts for the bare
  # workflow. android/ is not committed, so keep the managed-workflow scripts.
  git -C "$MOBILE_DIR" checkout -- package.json 2>/dev/null || true
fi

printf 'sdk.dir=C\\:/Android/sdk\n' > "$MOBILE_DIR/android/local.properties"

cd "$MOBILE_DIR/android"
"$GRADLE_BIN" assembleRelease --no-daemon \
  -Pandroid.buildToolsVersion=34.0.0 \
  -PreactNativeArchitectures="$ANDROID_ABI"

APK="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
OUT_DIR="${APK_OUT_DIR:-$MOBILE_DIR/build}"
mkdir -p "$OUT_DIR"
cp -f "$APK" "$OUT_DIR/app-release.apk"
echo
echo "APK: $OUT_DIR/app-release.apk"
ls -la "$OUT_DIR/app-release.apk"
BT="$(ls -d "$(cygpath -u "$ANDROID_HOME")"/build-tools/* 2>/dev/null | sort -V | head -1)"
if [ -n "$BT" ] && [ -x "$BT/aapt.exe" ]; then
  "$BT/aapt.exe" dump badging "$OUT_DIR/app-release.apk" 2>/dev/null \
    | grep -oE "versionCode='[0-9]+'|versionName='[^']+'|native-code: .*" | tr '\n' ' '
  echo
fi
