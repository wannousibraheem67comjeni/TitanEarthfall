# Play Console → App content → Data safety (what to answer)

These answers describe the code in this repository. Re-check them if you add SDKs.

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** data is collected or shared with us or third parties by the app's own code. |
| Is all of the user data collected by your app encrypted in transit? | Not applicable (no data leaves the device). |
| Do you provide a way for users to request that their data be deleted? | Not applicable: all data is on the device; uninstalling or *Settings → Reset progress* deletes it. |
| Location | The optional *My location* button reads **approximate location** once, rounds it, keeps it **only on the device** and never sends it. Because it is not collected (not transmitted off the device), it is not declared as collected. |
| Purchases (play edition) | Handled by Google Play Billing. Purchase history is processed by Google, not by the app owner. |
| Advertising ID / ads | None. |
| Account creation | None. |

Permissions used: `INTERNET` (WebView / Play Billing), `VIBRATE`, `ACCESS_COARSE_LOCATION` (optional map pin), `com.android.vending.BILLING` (play edition only).
