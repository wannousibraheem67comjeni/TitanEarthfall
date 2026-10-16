# إيبوت: مطاردة الذهب — EBOT Gold Chase

لعبة جري ثلاثية الأبعاد (Endless Runner) بهوية **إيبوت**، مستوحاة من أسلوب ألعاب مطاردة اللص وجمع الذهب، مع مشتريات Google Play داخل التطبيق.

A 3D endless runner with the **EBOT** identity: chase the thief robot *Glitch*, collect gold bars, build houses, unlock robots and worlds. Android build uses **Google Play Billing Library 9.1**.

## المحتوى / Features

| النظام | التفاصيل |
|---|---|
| الجري | 3 مسارات، سحب يمين/يسار، قفز، انزلاق، سقوط سريع، تعثّر جانبي، ركض فوق الشاحنات عبر المنحدرات، سيارات قادمة |
| اللص | غليتش يسرق الذهب في بداية كل جولة ويهرب بنفاثة |
| الزعيم | شاحنة غليتش ترمي صناديق وقنابل مع إنذار للمسار، اركل القنابل الزرقاء نحوها 3 مرات لهزيمتها (ذهب + جواهر) |
| القدرات | مغناطيس، خوذة الدرع، الطائرة النفاثة (ذهب السماء)، ذهب مضاعف ×2، انطلاقة صاروخية |
| العوالم | مدينة إيبوت، جادة النيون، جزيرة النخيل، غابة التروس، قمة الجليد، واحة الصقر |
| البيوت | 5 مراحل بناء لكل عالم، كل مرحلة تزيد مضاعف النقاط +1، إكمال البيت يفتح شخصية وعالماً جديداً |
| الشخصيات | 7 روبوتات (إيبوت، نوفا، بولت، زيتون، فروستي، صقر، تايتن) لكل منها ميزة و3 أزياء |
| العملات | ذهب، جواهر، بطاريات (للإنقاذ وفتح الخزائن)، انطلاقات صاروخية |
| الخزائن | خشبية مجانية كل 6 ساعات، فولاذية (من الجري أو بالذهب، فتح بالوقت أو بالبطاريات)، ماسية — مع عرض نسب الحظ |
| يومي | عجلة الحظ (مجانية كل 8 ساعات)، هدية 200 ذهب كل 8 ساعات، تقويم 7 أيام، 3 مهام متجددة |
| أخرى | إنقاذ بالبطاريات/الجواهر، تطويرات مدة القدرات، أفضل الجولات، العربية/الإنجليزية، جودة رسوميات، اهتزاز |

## مشتريات Google Play / In-app products

أنشئ هذه المنتجات في Play Console بنفس المعرّفات (Monetize → Products):

| Product ID | النوع | المحتوى | السعر المقترح |
|---|---|---|---|
| `gems_80` | One-time, consumable | 80 جوهرة | $0.99 |
| `gems_450` | One-time, consumable | 450 جوهرة | $4.99 |
| `gems_1000` | One-time, consumable | 1000 جوهرة | $9.99 |
| `gems_2200` | One-time, consumable | 2200 جوهرة | $19.99 |
| `gems_6000` | One-time, consumable | 6000 جوهرة | $49.99 |
| `gems_13000` | One-time, consumable | 13000 جوهرة | $99.99 |
| `gold_10k` | One-time, consumable | 10,000 ذهب | $1.99 |
| `gold_60k` | One-time, consumable | 60,000 ذهب | $9.99 |
| `starter_pack` | One-time, non-consumable | 300 جوهرة + 8000 ذهب + 5 بطاريات + 3 انطلاقات | $2.99 |
| `gold_doubler` | One-time, non-consumable | مضاعفة الذهب للأبد | $5.99 |
| `ebot_club` | Subscription (monthly base plan) | 60 جوهرة + 2 بطارية يومياً | $3.99/شهر |

- السعر المعروض في اللعبة هو السعر المحلي القادم من Google Play.
- تُمنح الجائزة فقط بعد حالة `PURCHASED`، ثم يتم الـ consume/acknowledge. المشتريات غير المكتملة تُعاد تلقائياً عند فتح التطبيق (لا تضيع أي عملية شراء)، وتُمنع الجوائز المكررة عبر purchase token.
- اختياري: ضع مفتاح الترخيص (Base64 public key) في `android/gradle.properties` → `ebotPlayLicenseKey=` لتفعيل التحقق من التوقيع على الجهاز. للحماية الكاملة استخدم تحققاً على الخادم عبر Google Play Developer API.
- نسخة الويب (ZIP / Artifact) لا تحتوي Google Play، لذلك المتجر فيها **تجريبي** ومكتوب عليه ذلك بوضوح.

## البناء / Build

```bash
# 1) web game
cd ebot-run/web && npm ci && npm run build      # -> dist/ (multi-file) and dist-single/index.html

# 2) Android (JDK 17+, Android SDK 36)
cd ../android
cp keystore.properties.example keystore.properties   # then fill in your upload key
./gradlew bundleRelease assembleRelease
# -> app/build/outputs/bundle/release/app-release.aab   (upload to Play Console)
# -> app/build/outputs/apk/release/app-release.apk      (install for testing)
```

التوقيع: `keystore.properties` (غير مرفوع للمستودع) أو متغيرات البيئة `EBOT_KEYSTORE`, `EBOT_KEYSTORE_PASSWORD`, `EBOT_KEY_ALIAS`, `EBOT_KEY_PASSWORD`. احتفظ بمفتاح الرفع (upload key) في مكان آمن؛ Google Play App Signing يحتفظ بمفتاح توقيع التطبيق النهائي.

قبل النشر: اختبر المشتريات عبر **License testers** ومسار **Internal testing** في Play Console (المشتريات لا تعمل في APK مثبت يدوياً إلا لحسابات الاختبار وبعد رفع نسخة للمتجر بنفس الـ applicationId `com.ebot.goldchase`).

## البنية / Structure

```
ebot-run/
  web/                 three.js game (ES modules, bundled with esbuild)
    src/config.js      all balancing data: worlds, characters, power-ups, products, vaults, missions
    src/game.js        engine: physics, collisions, power-ups, thief, boss, camera, lobby
    src/track.js       endless track generator and platforms (truck roofs/ramps)
    src/models.js      procedural low-poly models (no external art assets)
    src/ui.js          lobby, HUD, store, menus      src/progress.js  economy rules
    src/billing.js     JS side of Google Play Billing  src/audio.js     synthesized SFX/music
  android/             WebView app (Java) + BillingManager (Play Billing 9.1)
```

الخط: Baloo Bhaijaan 2 (رخصة SIL OFL، في `web/public/fonts/OFL.txt`). كل الرسومات والأصوات مولّدة برمجياً وأصلية.

## الخصوصية / Privacy

اللعبة لا تجمع بيانات شخصية، ولا إعلانات ولا تتبع. التقدم محفوظ على الجهاز (مع نسخ احتياطي تلقائي من Android). عمليات الشراء تتم عبر Google Play.
