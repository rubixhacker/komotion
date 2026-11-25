#!/bin/bash
# Populate the gitignored local build inputs of a fresh linked worktree, or stop with a
# pointer to the preparation script before Gradle configures the Android/iOS projects.
#
# `git worktree add` shares the repository's tracked files but not the untracked,
# gitignored files the builds read. The root settings.gradle.kts runs this script before
# any project is configured, so a new worktree either gains the files automatically or
# fails immediately with an actionable message instead of a mid-build Google Services or
# Xcode error.
#
# Regular checkouts and CI are left alone. CI writes these files from secrets in a normal
# checkout, and it must keep using those values rather than anything copied from a sibling.
#
# Usage: bash scripts/ci/prepare-worktree-inputs.sh
# Environment:
#   CAFF_LOCAL_INPUTS_DIR      checkout to copy from (default: the checkout that owns this
#                              worktree's .git directory)
#   CAFF_GOOGLE_SERVICES_JSON  google-services.json to copy (default: the one in the source
#                              checkout)
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
# Anchor relative CAFF_LOCAL_INPUTS_DIR / CAFF_GOOGLE_SERVICES_JSON overrides to the worktree
# root, not the caller's directory: settings.gradle.kts, scripts/tool and scripts/ci/ios-checks.sh
# invoke this script from different working directories.
cd "$root"

say() { printf 'prepare-worktree-inputs: %s\n' "$*" >&2; }

# CI injects the inputs from secrets. Never replace them from a sibling checkout.
[ "${GITHUB_ACTIONS:-}" = true ] && exit 0

# A linked worktree has a .git file; a regular checkout has a .git directory. Only a
# linked worktree can borrow inputs from the checkout that created it.
[ -f "$root/.git" ] || exit 0

# The slice reader decides whether a staged XCFramework can be borrowed. Source it only on the
# worktree path so a regular checkout or CI run never depends on this helper being present.
# shellcheck source=scripts/ci/shared-xcframework-slice.sh
source "$root/scripts/ci/shared-xcframework-slice.sh"

inputs=${CAFF_LOCAL_INPUTS_DIR:-}
if [ -z "$inputs" ]; then
  common=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  if [ -n "$common" ] && [ -d "$(dirname -- "$common")" ]; then
    inputs=$(CDPATH= cd -- "$(dirname -- "$common")" && pwd)
  fi
fi

google_services=${CAFF_GOOGLE_SERVICES_JSON:-${inputs:+$inputs/androidApp/google-services.json}}

# copy_input runs on the left of `||`, where Bash disables errexit for the whole function. Every
# fallible step therefore has to return failure explicitly; a bare `mkdir`/`cp` failure would
# otherwise fall through to the successful `say`. A target that is a directory after the copy
# also counts as missing: `cp source dir` succeeds by copying into the directory and leaves no
# regular file at the input path.
copy_input() {
  local target=$1 source=$2
  [ -f "$root/$target" ] && return 0
  [ -n "$source" ] && [ -f "$source" ] || return 1
  mkdir -p "$root/$(dirname -- "$target")" || return 1
  cp "$source" "$root/$target" || return 1
  [ -f "$root/$target" ] || return 1
  say "copied $target from $source"
}

# The staged Shared.xcframework is gitignored. Borrow it from the checkout that owns this worktree
# so SwiftPM resolves the Modules binary target without a missing-artifact error. It is optional:
# the Gradle staging task recreates it on a Mac.
# A malformed or mismatched artifact is never preserved: the Xcode pre-action restages the slice the
# build needs, and a stale copy must not make it believe one is already available.
copy_shared_xcframework() {
  local target=$1 source=$2
  if [ -d "$root/$target" ] && ! shared_xcframework_matches "$root/$target" any; then
    rm -rf "$root/$target" || return 1
  fi
  [ -f "$root/$target/Info.plist" ] && return 0
  [ -n "$source" ] && shared_xcframework_matches "$source" any || return 1
  mkdir -p "$root/$(dirname -- "$target")" || return 1
  rm -rf "$root/$target" || return 1
  cp -R "$source" "$root/$target" || return 1
  shared_xcframework_matches "$root/$target" any || return 1
  say "copied $target from $source"
}
copy_shared_xcframework iosApp/omarchy-xtool/Vendor/Shared.xcframework \
  "${inputs:+$inputs/iosApp/omarchy-xtool/Vendor/Shared.xcframework}" || true

missing=()
copy_input local.properties "${inputs:+$inputs/local.properties}" || missing+=(local.properties)
copy_input iosApp/Configuration/Keys.xcconfig \
  "${inputs:+$inputs/iosApp/Configuration/Keys.xcconfig}" ||
  missing+=(iosApp/Configuration/Keys.xcconfig)
copy_input androidApp/google-services.json "$google_services" ||
  missing+=(androidApp/google-services.json)

if [ ${#missing[@]} -eq 0 ]; then
  exit 0
fi

say "missing local build inputs: ${missing[*]}"
# Point at the worktree that needs the files, not the main checkout: prepare-local-inputs.sh
# resolves its target from its own location, so running it from the main checkout would prepare
# the wrong directory. CAFF_LOCAL_INPUTS_DIR names the checkout that holds the inputs.
# Quote both paths so the command is copy-pasteable when a worktree or main checkout lives under
# a directory with spaces or shell metacharacters. printf '%q' produces a single shell word.
printf -v root_q '%q' "$root"
if [ -n "$inputs" ]; then
  printf -v inputs_q '%q' "$inputs"
else
  inputs_q='<main-checkout>'
fi
say "run: (cd $root_q && CAFF_LOCAL_INPUTS_DIR=$inputs_q bash scripts/ci/prepare-local-inputs.sh)"

# Google Services fails the Android build when its JSON is absent, so an unmet
# google-services.json stops the build here. local.properties also supplies AGP's sdk.dir and
# the RevenueCat / Firebase debug keys, and Keys.xcconfig is read by Xcode; a Gradle build can
# still configure without them when ANDROID_HOME is set, so they get the same actionable
# message as a warning instead of a hard failure. Say so when that condition does not hold.
case " ${missing[*]} " in
  *" local.properties "*)
    [ -n "${ANDROID_HOME:-}" ] ||
      say "ANDROID_HOME is unset; Gradle needs local.properties for sdk.dir, so set CAFF_LOCAL_INPUTS_DIR or ANDROID_HOME"
    ;;
esac
case " ${missing[*]} " in
  *" androidApp/google-services.json "*) exit 1 ;;
  *) exit 0 ;;
esac
