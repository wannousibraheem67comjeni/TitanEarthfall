#!/usr/bin/env bash
# One-command build of Hopinet: web game -> Android APK + AAB (play + free editions) -> release files.
# Runs entirely on this machine: no server, no database.
# Needs: Node.js 18+, JDK 17+ (21 recommended), Android SDK platform 36 (ANDROID_HOME or android/local.properties).
set -euo pipefail
cd "$(dirname "$0")"
VER="$(grep -o "GAME_VERSION = '[^']*'" web/src/config.js | cut -d"'" -f2)"
OUT="releases"

echo "== 1/4 Web build ($VER)"
(
  cd web
  [ -d node_modules ] || npm install --no-audit --no-fund
  node build.mjs
)

echo "== 2/4 Android build (APK + AAB, play + free)"
[ -f android/keystore.properties ] || echo "!! android/keystore.properties not found: release files will be unsigned (see keystore.properties.example)"
(cd android && ./gradlew --no-daemon assemblePlayRelease bundlePlayRelease assembleFreeRelease bundleFreeRelease)

echo "== 3/4 Packaging into $OUT/"
mkdir -p "$OUT"
cp android/app/build/outputs/apk/play/release/*.apk "$OUT/Hopinet-$VER-play.apk"
cp android/app/build/outputs/apk/free/release/*.apk "$OUT/Hopinet-$VER-free.apk"
cp android/app/build/outputs/bundle/playRelease/*.aab "$OUT/Hopinet-$VER-play.aab"
cp android/app/build/outputs/bundle/freeRelease/*.aab "$OUT/Hopinet-$VER-free.aab"
cp web/dist-single/index.html "$OUT/Hopinet-$VER-single-file.html"
rm -f "$OUT"/Hopinet-"$VER"-web-*.zip "$OUT"/Hopinet-"$VER"-source.zip "$OUT"/Hopinet-"$VER"-store-pack.zip
(cd web/dist && zip -qr "../../$OUT/Hopinet-$VER-web-pwa.zip" .)                       # multi-file + PWA (itch.io, any web host)
(cd web/dist-single && zip -q "../../$OUT/Hopinet-$VER-web-single-file.zip" index.html README.txt)
zip -qr "$OUT/Hopinet-$VER-store-pack.zip" store-listing docs/PLAY_CONSOLE_SETUP.md docs/privacy.html docs/privacy-ar.html
(cd .. && zip -qr "$(basename "$OLDPWD")/$OUT/Hopinet-$VER-source.zip" "$(basename "$OLDPWD")" \
  -x "*/node_modules/*" "*/web/dist/*" "*/web/dist-single/*" "*/.gradle/*" "*/android/build/*" "*/app/build/*" \
     "*/assets/www/*" "*/keystore/*" "*/keystore.properties" "*/local.properties" "*/releases/*" "*/docs/locks/*")

echo "== 4/4 Checksums"
(cd "$OUT" && sha256sum Hopinet-"$VER"-* > SHA256SUMS.txt)
ls -la "$OUT"
echo "Done."
