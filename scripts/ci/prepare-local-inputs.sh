#!/bin/bash
# Copy the gitignored build inputs into a checkout that holds tracked files only, such as a
# no-mistakes run worktree, so scripts/ci/*.sh can build there.
#
# CI writes the same files from secrets in its workflows. A file the checkout already has is kept;
# google-services.json is checked either way, because the debug build fails without a client for
# its package.
#
# Usage: scripts/ci/prepare-local-inputs.sh [TARGET_CHECKOUT]
#   TARGET_CHECKOUT  checkout to stage the inputs into (default: this script's own checkout).
#                    The factory passes the sandbox worktree so the host-owned copy of this
#                    script stages inputs without running any script from the branch under test.
# Environment:
#   CAFF_LOCAL_INPUTS_DIR      checkout to copy local.properties and
#                              iosApp/Configuration/Keys.xcconfig from
#                              (default: $HOME/Workspace/komotion, the main checkout)
#   CAFF_GOOGLE_SERVICES_JSON  google-services.json to copy; it needs a client for both app
#                              packages, like the GOOGLE_SERVICES_JSON secret
#                              (default: androidApp/google-services.json in CAFF_LOCAL_INPUTS_DIR)
set -euo pipefail

script_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
root=$(CDPATH= cd -- "${1:-$script_root}" && pwd)
cd "$root"

# The factory copies this host-owned script alone into a checkout with no other repository files,
# so the slice reader is inlined here rather than sourced from a companion file. It mirrors the
# reader in scripts/ci/shared-xcframework-slice.sh, which the worktree-side scripts source.
shared_xcframework_plist_string() {
  awk -v key="$2" '
    index($0, "<key>" key "</key>") { found = 1; next }
    found && /<string>/ {
      value = $0
      sub(/^.*<string>/, "", value)
      sub(/<\/string>.*$/, "", value)
      print value
      exit
    }
    found && /<key>/ { exit }
  ' "$1"
}

shared_xcframework_plist_has_arm64() {
  awk '
    index($0, "<key>SupportedArchitectures</key>") { found = 1; next }
    found && /<\/array>/ { found = 0 }
    found && index($0, "<string>arm64</string>") { hit = 1 }
    END { exit !hit }
  ' "$1"
}

shared_xcframework_matches() {
  local dir=$1 plist="$1/Info.plist" identifier platform variant
  [ -f "$plist" ] || return 1
  identifier=$(shared_xcframework_plist_string "$plist" LibraryIdentifier) || return 1
  platform=$(shared_xcframework_plist_string "$plist" SupportedPlatform) || return 1
  variant=$(shared_xcframework_plist_string "$plist" SupportedPlatformVariant) || return 1
  case "$identifier" in
    ios-arm64 | ios-simulator-arm64) ;;
    *) return 1 ;;
  esac
  [ "$platform" = ios ] || return 1
  if [ "$identifier" = ios-simulator-arm64 ]; then
    [ "$variant" = simulator ] || return 1
  else
    [ -z "$variant" ] || return 1
  fi
  shared_xcframework_plist_has_arm64 "$plist" || return 1
  [ -f "$dir/$identifier/Shared.framework/Shared" ] || return 1
  [ -f "$dir/$identifier/Shared.framework/Headers/Shared.h" ] || return 1
  [ -f "$dir/$identifier/Shared.framework/Modules/module.modulemap" ] || return 1
  return 0
}

inputs=${CAFF_LOCAL_INPUTS_DIR:-$HOME/Workspace/komotion}
google_services=${CAFF_GOOGLE_SERVICES_JSON:-$inputs/androidApp/google-services.json}
debug_package=com.hackedcube.caffconscious.debug

say() { printf 'prepare-local-inputs: %s\n' "$*" >&2; }
fail() { say "$*"; exit 1; }

copy_input() {
  local source=$1 target=$2
  if [ -f "$target" ]; then
    return 0
  fi
  [ -f "$source" ] || fail "$target is missing and $source does not exist; set CAFF_LOCAL_INPUTS_DIR"
  [ "$(cd "$(dirname "$source")" && pwd)/$(basename "$source")" != "$root/$target" ] \
    || fail "$target is missing from this checkout, which is also the source"
  mkdir -p "$(dirname "$target")"
  cp "$source" "$target"
  say "copied $target from $source"
}

# The single-slice Shared.xcframework is gitignored; borrow the staged copy from the source checkout
# so a fresh worktree's SwiftPM binary target resolves without a missing-artifact error. A malformed
# or mismatched artifact is never preserved: the Xcode pre-action restages the slice the build needs,
# and a stale copy must not make it believe one is already available.
copy_shared_xcframework() {
  local source=$1 target=$2
  if [ -d "$target" ] && ! shared_xcframework_matches "$target" any; then
    rm -rf "$target"
  fi
  [ -f "$target/Info.plist" ] && return 0
  shared_xcframework_matches "$source" any || return 0
  [ "$(cd "$(dirname "$source")" && pwd)/$(basename "$source")" != "$root/$target" ] || return 0
  mkdir -p "$(dirname "$target")"
  rm -rf "$target"
  cp -R "$source" "$target"
  shared_xcframework_matches "$target" any || return 0
  say "copied $target from $source"
}

copy_input "$inputs/local.properties" local.properties
copy_input "$inputs/iosApp/Configuration/Keys.xcconfig" iosApp/Configuration/Keys.xcconfig
copy_input "$google_services" androidApp/google-services.json
copy_shared_xcframework "$inputs/iosApp/omarchy-xtool/Vendor/Shared.xcframework" \
  iosApp/omarchy-xtool/Vendor/Shared.xcframework
grep -q "\"$debug_package\"" androidApp/google-services.json \
  || fail "androidApp/google-services.json has no client for $debug_package; replace it with the file the GOOGLE_SERVICES_JSON secret holds, or set CAFF_GOOGLE_SERVICES_JSON"
