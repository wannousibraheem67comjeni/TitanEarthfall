# Hopinet · هوبينت

**Hop. Swim. Soar.** — a fully 3D endless runner for Android and the web. Run, jump, slide, **swim and dive**, hop into a
**car, speed boat, ship or plane** you find on the road, catch the **magnet, bomb magnet, gold doubler, jet pack and helmet**,
beat **Captain Krab's flying pirate airship**, play **36 stages on a real world map**, and build a **luxury home** in every world.

> نسخة عربية مختصرة في الأسفل ↓

| | |
|---|---|
| Version | `3.1.2.5.5.6` (versionCode `113`) |
| Android package | `com.elevo.hopinet` (Google Play edition) · `com.elevo.hopinet.free` (free edition) |
| Engine | three.js r170 (procedural 3D, no model/audio files) bundled with esbuild |
| Offline | 100 % offline: no game server, no database, no ads, no tracking |
| Languages | Arabic (RTL, default) and English |

## What is in the game

* **Movement:** run, jump (with flips), slide, switch lanes, **swim** in water zones, **dive** under nets, jump **broken bridges**.
* **Vehicles** (found on the road): race car, speed boat, giant ship, plane (3 altitude lanes, sky rings, drones, storms, kites). The plane is easy to grab: it appears early and often.
* **Power-ups:** Magnet · Gold Doubler · Jet Pack · **Bomb Magnet** (pulls bombs to you and blows them up) · **Helmet** (one-hit shield; **the music and sounds are muffled while it is worn**).
* **6 worlds** with their own sea, sky, scenery and music: Sunny Harbor, Neon Bay, Coral Islands, Emerald Jungle, Frost Fjord, Golden Dunes.
* **36 campaign stages** on a real offline world map (Lisbon, Tokyo Bay, Maldives, Amazon, Norwegian fjords, Dubai desert) with 3 stars each; optional **My location** pin that never leaves the device.
* **Luxury home:** 5 build stages per world + 10 luxury items (pool, fountain, supercar, helipad, yacht, golden statue…) that boost coins.
* **7 heroes** (rabbit, fox, bear, cat, frog, owl, dino) with outfits and perks, villain **Captain Krab** with an airship boss.
* Daily rewards, missions, reward wheel, vaults (drop rates shown), upgrades, big green **Run again** button after every fall.
* **Music:** original, energetic, procedural per-world tracks that build up with speed.

## Downloads (what the build produces)

| File | Use |
|---|---|
| `Hopinet-<ver>-play.aab` | Upload to Google Play Console (real in-app purchases) |
| `Hopinet-<ver>-play.apk` | Side-load / test the Play edition |
| `Hopinet-<ver>-free.apk` / `.aab` | Free edition without any purchase code (`com.elevo.hopinet.free`) |
| `Hopinet-<ver>-web-pwa.zip` | Multi-file web game, installable PWA (itch.io, any static host) |
| `Hopinet-<ver>-web-single-file.zip` and `…-single-file.html` | One self-contained HTML file, double-click to play |
| `Hopinet-<ver>-store-pack.zip` | Play listing texts (AR/EN), graphics, privacy policy, Play Console guide |
| `Hopinet-<ver>-source.zip` | Full source (no secrets) |

GitHub Actions builds all of them: push a tag `v3.1.2.5.5.6` and the **Release** workflow attaches signed files to a GitHub release.
The **Pages** workflow publishes the playable web build and `privacy.html`.

## Build locally

Needs Node 18+, JDK 17+ and the Android SDK (platform 36).

```bash
./build.sh                    # web + Android (play & free) + all packages into releases/
# or step by step
cd web && npm install && node build.mjs          # -> web/dist, web/dist-single
cd ../android && ./gradlew assemblePlayDebug assembleFreeDebug
```

Create your own upload key and keep it private (it is git-ignored):

```bash
keytool -genkeypair -v -keystore android/keystore/hopinet-upload.jks -storetype PKCS12 \
        -alias hopinet-upload -keyalg RSA -keysize 2048 -validity 10000
cp android/keystore.properties.example android/keystore.properties   # then fill in the passwords
```

## Real purchases: Google Play Billing (and Google Pay)

Only the **play** edition contains billing. It uses **Google Play Billing Library 9.1** — the mandatory way to sell digital
goods in an Android app on Google Play. The Google Pay button inside the Play payment sheet is how the player pays.
(The standalone *Google Pay API* is for physical goods and is not allowed for in-app digital items.)

* The shop shows a price **only** if Google Play returned that product, otherwise the button says *Unavailable*.
* Rewards are granted only after Google Play reports `PURCHASED`; consumables are consumed and lifetime items acknowledged
  after the reward is saved; purchases are de-duplicated by token and re-delivered after a crash.
* In a browser or the free edition **nothing can be bought and nothing is ever granted**.

To make purchases work you must create the products in **your** Play Console: see [`docs/PLAY_CONSOLE_SETUP.md`](docs/PLAY_CONSOLE_SETUP.md)
(product IDs: `gems_80`, `gems_450`, `gems_1000`, `gems_2200`, `gems_6000`, `gems_13000`, `gold_10k`, `gold_60k`, `starter_pack`, `gold_doubler`, subscription `hopinet_club`).

## GitHub setup (one time)

1. Repository **Settings → Pages → Source: GitHub Actions** (publishes the web build and privacy policy).
2. Optional release signing secrets: `HOPINET_KEYSTORE_BASE64` (`base64 -w0 hopinet-upload.jks`), `HOPINET_KEYSTORE_PASSWORD`,
   `HOPINET_KEY_ALIAS`, `HOPINET_KEY_PASSWORD`, `HOPINET_PLAY_LICENSE_KEY` (Play Console licensing key, optional).
3. Push a tag: `git tag v3.1.2.5.5.6 && git push origin v3.1.2.5.5.6`.

## Project layout

```
web/            the game (src/*.js, build.mjs) -> dist (multi-file + PWA) and dist-single (one HTML)
android/        WebView shell; flavors: play (Billing) and free; src/main, src/play, src/free
tools/          offline data generators (world map outline, store graphics)
docs/           CONTRACTS.md (module APIs), PLAY_CONSOLE_SETUP.md, privacy policy pages
store-listing/  Play texts (en/ar), data-safety answers, graphics
.github/workflows/   CI, release, pages
```

Controls: swipe left/right/up/down (or arrow keys / WASD / space). Android back = pause/close.

---

## بالعربية باختصار

**هوبينت** لعبة جري ثلاثية الأبعاد بالكامل: اجرِ، اقفز، انزلق، **اسبح واغطس**، واركب **السيارة والقارب والسفينة والطائرة** عندما تجدها على الطريق،
والتقط **المغناطيس وجاذب القنابل ومضاعف الذهب وحقيبة الطيران والخوذة** (يتشوّش الصوت قليلاً عند ارتداء الخوذة)، واهزم **سفينة الكابتن كراب الطائرة**،
والعب **36 مرحلة** على **خريطة العالم**، وابنِ **بيتاً فاخراً** في كل عالم. خلفية اللعبة بحار ومناظر وسماء وليست سوداء أبداً.
بعد كل سقوط يظهر زر أخضر كبير **«اركض مرة أخرى»**.

* النسخة **play**: مشتريات حقيقية عبر **Google Play Billing** (الطريقة الإلزامية للسلع الرقمية؛ وGoogle Pay يظهر داخل نافذة الدفع).
  يجب إنشاء المنتجات في Play Console الخاص بك (راجع `docs/PLAY_CONSOLE_SETUP.md`). لا يوجد أي شراء وهمي: يظهر السعر فقط إن أعاده Google Play.
* النسخة **free**: بلا أي كود شراء.
* تعمل بالكامل **بدون إنترنت**، بلا خوادم ولا قواعد بيانات ولا إعلانات.
* **الصيغ:** AAB + APK (play/free)، ويب PWA، ملف HTML واحد، حزمة المتجر، المصدر. كلها تُبنى بأمر `./build.sh` أو عبر GitHub Actions.
