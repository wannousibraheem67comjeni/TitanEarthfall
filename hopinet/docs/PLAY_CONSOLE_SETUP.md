# Google Play setup (real purchases)

The game sells items **only through Google Play Billing**. Nothing is simulated: the shop shows a price
only when Google Play returns the product, and rewards are granted only after Google Play reports
`PURCHASED`. For that to work the products below must exist in **your** Play Console. This cannot be done
from code; it needs your developer account.

> **Google Pay vs. Google Play Billing.** The Google Pay API is for physical goods/services outside Google Play.
> Digital goods sold inside an Android app distributed on Google Play (gems, coins, subscriptions) **must** use
> Google Play Billing, which is what this project uses. The Play Store payment sheet *is* where the player pays
> with Google Pay / cards / carrier billing / gift cards.

## 1. Create the app

1. Play Console → **Create app** → name *Hopinet*, default language, **Game**, **Free** (in-app purchases are declared separately).
2. Package name must be `com.elevo.hopinet` (the *free* edition is `com.elevo.hopinet.free` and is a separate app/listing if you publish it on Play).
3. Release → Testing → **Internal testing** → create a release → upload `Hopinet-<version>-play.aab` (signed with your upload key; enable **Play App Signing**).
4. Add your tester Gmail accounts to the internal testing list **and** to *Settings → License testing* so test purchases are free and reversible.
5. Install the app from the internal-testing link (Google Play only returns products to builds installed from Play).

## 2. In-app products (Monetize → Products → In-app products)

Product IDs must match exactly. Type = *One-time product* (managed), purchase option **Buy**, status **Active**.

| Product ID | Gives | Consumed | Suggested price |
|---|---|---|---|
| `gems_80` | 80 gems | yes | $0.99 |
| `gems_450` | 450 gems | yes | $4.99 |
| `gems_1000` | 1,000 gems | yes | $9.99 |
| `gems_2200` | 2,200 gems | yes | $19.99 |
| `gems_6000` | 6,000 gems | yes | $49.99 |
| `gems_13000` | 13,000 gems | yes | $99.99 |
| `gold_10k` | 10,000 coins | yes | $1.99 |
| `gold_60k` | 60,000 coins | yes | $9.99 |
| `starter_pack` | 300 gems + 8,000 coins + 5 batteries + 3 rocket starts (once) | no (acknowledged) | $2.99 |
| `gold_doubler` | all coins ×2 forever | no (acknowledged) | $5.99 |

Prices are only suggestions; the game displays whatever price Google Play returns for the player's country.

## 3. Subscription (Monetize → Products → Subscriptions)

| Product ID | Base plan | Gives |
|---|---|---|
| `hopinet_club` | e.g. `monthly`, auto-renewing, billing period 1 month, **Active** | 60 gems + 2 batteries every day while active |

## 4. Optional: purchase signature check

Monetize → Monetization setup → **Licensing** → copy the Base64 public key and set it as
`hopinetPlayLicenseKey` (in `android/gradle.properties`, or the `HOPINET_PLAY_LICENSE_KEY` GitHub secret).
With a key set, the app verifies every purchase signature on the device (no server needed).

## 5. Store listing items

* Privacy policy URL: `https://<your-github-user>.github.io/<repo>/privacy.html` (published by the Pages workflow).
* Data safety form: see `store-listing/data-safety.md`.
* Content rating questionnaire: cartoon fantasy violence (the villain crab throws bombs); no user-generated content, no gambling with real money.
  Note: vaults and the reward wheel show their drop rates in-game and cost only in-game currency.
* Texts: `store-listing/en-US.md`, `store-listing/ar.md`. Graphics: `store-listing/graphics/`.

## 6. How to verify a real purchase end to end (what the developer must do)

1. Install the internal-testing build from Play on a real device (not an emulator without Play, not a side-loaded APK).
2. Open the in-game **Shop**. The banner must say *Connected to Google Play* and the buttons must show localized prices.
   If it says a product is missing, that product ID is not active in Play Console yet.
3. Buy `gems_80` with a license-tester account. The gems must appear and the purchase must be consumed
   (buying it again must be possible). Then buy `gold_doubler`, kill the app, reopen: it must stay owned.
4. Subscribe to `hopinet_club`; the Club daily reward must be claimable.
5. *Settings → Restore purchases* must report the owned items.
