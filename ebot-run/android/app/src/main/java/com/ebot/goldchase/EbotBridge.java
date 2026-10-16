package com.ebot.goldchase;

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

/** Methods exposed to the game as window.EbotNative. Called on the WebView's JS thread. */
public final class EbotBridge {
    private static final String PREFS = "ebot_save";
    private static final String KEY = "profile";

    private final Activity activity;
    private final BillingManager billing;
    private final SharedPreferences prefs;

    EbotBridge(Activity activity, BillingManager billing) {
        this.activity = activity;
        this.billing = billing;
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public String platform() {
        return "android";
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
    public void restorePurchases() {
        billing.queryPurchases(true);
    }

    /** Mirrors the save game to SharedPreferences so Android Auto Backup can restore it. */
    @JavascriptInterface
    public void saveData(String json) {
        prefs.edit().putString(KEY, json).apply();
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
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)));
            }
        });
    }

    @JavascriptInterface
    public void appReady() {
        // Reserved for a native splash hand-off; the web layer shows its own splash.
    }
}
