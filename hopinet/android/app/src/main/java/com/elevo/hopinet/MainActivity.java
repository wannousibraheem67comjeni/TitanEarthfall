package com.elevo.hopinet;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

/** Hosts the game (bundled web build) in a full-screen WebView and bridges native services. */
public final class MainActivity extends ComponentActivity {
    private static final String TAG = "Hopinet";
    private static final String START_URL = "https://appassets.androidplatform.net/assets/www/index.html";

    // Renderer crash guard: stop recreating after repeated crashes in a short time.
    private static int rendererCrashes;
    private static long firstCrashAt;

    private WebView webView;
    private BillingController billing;
    // "My location" on the world map: the page asks through the WebView, the player decides here.
    private ActivityResultLauncher<String> locationPermission;
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingGeoOrigin;
    private volatile int insetTop, insetBottom;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        locationPermission = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            if (pendingGeo != null) pendingGeo.invoke(pendingGeoOrigin, granted, false);
            pendingGeo = null;
            pendingGeoOrigin = null;
        });

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF08303F);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setOffscreenPreRaster(true);

        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("appassets.androidplatform.net".equals(uri.getHost())) return false;
                // Never navigate the game view away; open links in the browser instead.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException | SecurityException ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushInsets(); // the page now defines window.hopinetSetInsets
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.e(TAG, "WebView renderer gone (crash=" + detail.didCrash() + ")");
                // The dead WebView must not be used again: detach and destroy it first.
                if (webView != null) {
                    ViewGroup parent = (ViewGroup) webView.getParent();
                    if (parent != null) parent.removeView(webView);
                    webView.destroy();
                    webView = null;
                }
                long now = SystemClock.elapsedRealtime();
                if (now - firstCrashAt > 60_000) {
                    firstCrashAt = now;
                    rendererCrashes = 0;
                }
                if (++rendererCrashes <= 3) recreate();
                else finish();
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_COARSE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                    return;
                }
                pendingGeo = callback;
                pendingGeoOrigin = origin;
                locationPermission.launch(Manifest.permission.ACCESS_COARSE_LOCATION);
            }

            @Override
            public void onGeolocationPermissionsHidePrompt() {
                pendingGeo = null;
                pendingGeoOrigin = null;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                if (BuildConfig.DEBUG) Log.d(TAG, m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        billing = BillingFactory.create(this, this::runJs);
        webView.addJavascriptInterface(new HopinetBridge(this, billing), "HopinetNative");

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            Insets i = insets.getInsets(WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.systemBars());
            float d = getResources().getDisplayMetrics().density;
            insetTop = Math.round(i.top / d);
            insetBottom = Math.round(i.bottom / d);
            pushInsets();
            return WindowInsetsCompat.CONSUMED;
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView == null) {
                    finish();
                    return;
                }
                webView.evaluateJavascript("(window.hopinetOnBack&&window.hopinetOnBack())?'1':'0'", value -> {
                    if (!"\"1\"".equals(value)) moveTaskToBack(true);
                });
            }
        });

        hideSystemBars();
        // Progress lives in local storage, so a fresh load always restores the game correctly.
        webView.loadUrl(START_URL);
    }

    /** Safe-area insets in CSS pixels, read by the page through HopinetNative.getInsets(). */
    int[] insets() {
        return new int[]{insetTop, insetBottom};
    }

    private void pushInsets() {
        runJs("window.hopinetSetInsets&&window.hopinetSetInsets(" + insetTop + "," + insetBottom + ")");
    }

    private void hideSystemBars() {
        if (webView == null) return;
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), webView);
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    void runJs(String js) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(js, null);
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
        runJs("window.hopinetOnResume&&window.hopinetOnResume()");
        if (billing != null) billing.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            // Synchronous enough: the JS pause handler saves progress and holds timers.
            webView.evaluateJavascript("window.hopinetOnPause&&window.hopinetOnPause()", null);
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (billing != null) billing.destroy();
        if (webView != null) {
            webView.removeJavascriptInterface("HopinetNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
