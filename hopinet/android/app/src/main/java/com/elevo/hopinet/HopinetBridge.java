package com.elevo.hopinet;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.webkit.JavascriptInterface;

/** Methods exposed to the game as window.HopinetNative. Called on the WebView's JS thread. */
public final class HopinetBridge {
    private static final String PREFS = "hopinet_save";
    private static final String KEY = "profile";

    private final Activity activity;
    private final BillingController billing;
    private final SharedPreferences prefs;

    HopinetBridge(Activity activity, BillingController billing) {
        this.activity = activity;
        this.billing = billing;
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public String platform() {
        return "android";
    }

    /** Which edition this APK is: "play" (Google Play purchases) or "free" (no real-money store). */
    @JavascriptInterface
    public String flavor() {
        return BuildConfig.FLAVOR;
    }

    @JavascriptInterface
    public void billingInit(String productsJson) {
        billing.init(productsJson);
    }

    @JavascriptInterface
    public void purchase(String productId) {
        activity.runOnUiThread(() -> billing.launchPurchase(activity, productId));
    }

    @JavascriptInterface
    public void finishPurchase(String purchaseToken, boolean consume) {
        billing.finish(purchaseToken, consume);
    }

    @JavascriptInterface
    public void refreshProducts() {
        billing.refreshProducts();
    }

    @JavascriptInterface
    public void restorePurchases() {
        billing.queryPurchases(true);
    }

    /**
     * Mirrors the save game to SharedPreferences (also used by Android Auto Backup). commit() is
     * synchronous, so a purchase grant is on disk before Google Play is told to consume it.
     * This runs on the WebView's JavaBridge thread, never on the UI thread.
     */
    @JavascriptInterface
    public boolean saveData(String json) {
        return prefs.edit().putString(KEY, json).commit();
    }

    /** Current safe-area insets in CSS pixels as {"top":n,"bottom":n}. */
    @JavascriptInterface
    public String getInsets() {
        int[] i = ((MainActivity) activity).insets();
        return "{\"top\":" + i[0] + ",\"bottom\":" + i[1] + "}";
    }

    @JavascriptInterface
    public String loadData() {
        return prefs.getString(KEY, "");
    }

    @JavascriptInterface
    public void vibrate(int ms) {
        int dur = Math.max(1, Math.min(ms, 400));
        Vibrator v;
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            v = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (v == null || !v.hasVibrator()) return;
        v.vibrate(VibrationEffect.createOneShot(dur, VibrationEffect.DEFAULT_AMPLITUDE));
    }

    @JavascriptInterface
    public void openStorePage() {
        String pkg = activity.getPackageName();
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)));
            } catch (ActivityNotFoundException e) {
                try {
                    activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)));
                } catch (ActivityNotFoundException | SecurityException ignored) {
                    // No store and no browser on this device: nothing to open.
                }
            }
        });
    }

    @JavascriptInterface
    public void appReady() {
        // Reserved for a native splash hand-off; the web layer shows its own splash.
    }
}
