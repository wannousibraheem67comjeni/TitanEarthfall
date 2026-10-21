#!/usr/bin/env bash
# Copies this project into a clone of the GitHub repository (under hopinet/, workflows at the repo root).
# usage: tools/publish-to-repo.sh /path/to/clone
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="${1:?path to the git clone}"
rm -rf "$DST/hopinet"
mkdir -p "$DST/hopinet" "$DST/.github/workflows"
(cd "$SRC" && tar \
  --exclude=./node_modules --exclude='*/node_modules' --exclude=./web/dist --exclude=./web/dist-single \
  --exclude='*/.gradle' --exclude=./android/build --exclude=./android/app/build \
  --exclude=./android/app/src/main/assets/www --exclude=./android/keystore --exclude=./android/keystore.properties \
  --exclude=./android/local.properties --exclude=./releases --exclude=./.github --exclude=./docs/locks \
  --exclude='*.apk' --exclude='*.aab' -cf - .) | (cd "$DST/hopinet" && tar -xf -)
cp "$SRC"/.github/workflows/*.yml "$DST/.github/workflows/"
echo "copied to $DST"
