package com.ebot.goldchase;

import android.app.Activity;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Google Play Billing (Play Billing Library 9) for the game.
 *
 * Flow: the web game calls {@link #init} with its product IDs. Product details and existing
 * purchases are queried once connected. Every PURCHASED purchase is forwarded to JavaScript,
 * which grants the reward, stores the purchase token (to de-duplicate re-deliveries) and then
 * calls {@link #finish}: consumables are consumed, one-time products and subscriptions are
 * acknowledged. Purchases that are not finished (e.g. the app was killed) are delivered again
 * by {@link #queryPurchases} on the next launch or resume, so nothing is ever lost.
 */
public final class BillingManager implements PurchasesUpdatedListener {
    private static final String TAG = "EbotBilling";

    /** Receives JavaScript snippets to evaluate in the game WebView. */
    public interface JsSink {
        void run(String js);
    }

    private final Context context;
    private final JsSink js;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, ProductDetails> details = new ConcurrentHashMap<>();
    private final List<String> inappIds = Collections.synchronizedList(new ArrayList<>());
    private final List<String> subsIds = Collections.synchronizedList(new ArrayList<>());
    private BillingClient client;
    private volatile boolean ready;

    public BillingManager(Context context, JsSink js) {
        this.context = context.getApplicationContext();
        this.js = js;
    }

    /** Called from JavaScript with {"inapp":[...], "subs":[...]}. */
    public void init(String productsJson) {
        try {
            JSONObject o = new JSONObject(productsJson);
            inappIds.clear();
            subsIds.clear();
            JSONArray a = o.optJSONArray("inapp");
            if (a != null) for (int i = 0; i < a.length(); i++) inappIds.add(a.getString(i));
            JSONArray s = o.optJSONArray("subs");
            if (s != null) for (int i = 0; i < s.length(); i++) subsIds.add(s.getString(i));
        } catch (JSONException e) {
            Log.w(TAG, "bad product list", e);
        }
        main.post(() -> {
            if (client == null) {
                client = BillingClient.newBuilder(context)
                        .setListener(this)
                        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                        .enableAutoServiceReconnection()
                        .build();
            }
            connect();
        });
    }

    private void connect() {
        if (client == null || client.isReady()) {
            if (client != null) onConnected();
            return;
        }
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                ready = result.getResponseCode() == BillingClient.BillingResponseCode.OK;
                if (ready) onConnected();
                else {
                    Log.w(TAG, "setup failed: " + result.getResponseCode() + " " + result.getDebugMessage());
                    callJs("onReady", "false");
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // enableAutoServiceReconnection() re-establishes the connection on the next call.
                ready = false;
            }
        });
    }

    private void onConnected() {
        ready = true;
        callJs("onReady", "true");
        queryProducts();
        queryPurchases(false);
    }

    private void queryProducts() {
        queryDetails(BillingClient.ProductType.INAPP, new ArrayList<>(inappIds));
        queryDetails(BillingClient.ProductType.SUBS, new ArrayList<>(subsIds));
    }

    private void queryDetails(String type, List<String> ids) {
        if (ids.isEmpty()) return;
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String id : ids) {
            products.add(QueryProductDetailsParams.Product.newBuilder().setProductId(id).setProductType(type).build());
        }
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder().setProductList(products).build();
        client.queryProductDetailsAsync(params, (result, queryResult) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                Log.w(TAG, "product query failed: " + result.getDebugMessage());
                return;
            }
            JSONArray out = new JSONArray();
            for (ProductDetails pd : queryResult.getProductDetailsList()) {
                details.put(pd.getProductId(), pd);
                try {
                    JSONObject j = new JSONObject();
                    j.put("productId", pd.getProductId());
                    j.put("title", pd.getName());
                    j.put("type", type);
                    j.put("price", formattedPrice(pd));
                    out.put(j);
                } catch (JSONException ignored) {
                }
            }
            callJs("onProducts", JSONObject.quote(out.toString()));
        });
    }

    private static String formattedPrice(ProductDetails pd) {
        if (BillingClient.ProductType.SUBS.equals(pd.getProductType())) {
            List<ProductDetails.SubscriptionOfferDetails> offers = pd.getSubscriptionOfferDetails();
            if (offers == null || offers.isEmpty()) return "";
            List<ProductDetails.PricingPhase> phases = baseOffer(offers).getPricingPhases().getPricingPhaseList();
            return phases.isEmpty() ? "" : phases.get(phases.size() - 1).getFormattedPrice();
        }
        List<ProductDetails.OneTimePurchaseOfferDetails> list = pd.getOneTimePurchaseOfferDetailsList();
        if (list != null && !list.isEmpty()) return list.get(0).getFormattedPrice();
        ProductDetails.OneTimePurchaseOfferDetails one = pd.getOneTimePurchaseOfferDetails();
        return one != null ? one.getFormattedPrice() : "";
    }

    /** The base plan (no offer id) is preferred so the displayed price matches what is charged. */
    private static ProductDetails.SubscriptionOfferDetails baseOffer(List<ProductDetails.SubscriptionOfferDetails> offers) {
        for (ProductDetails.SubscriptionOfferDetails o : offers) if (o.getOfferId() == null) return o;
        return offers.get(0);
    }

    /** Starts the Google Play purchase sheet. Must run on the UI thread. */
    public void launchPurchase(Activity activity, String productId) {
        if (client == null || !ready) {
            fail("unavailable", "billing not ready");
            if (client != null) connect();
            return;
        }
        ProductDetails pd = details.get(productId);
        if (pd == null) {
            fail("unavailable", "unknown product " + productId);
            return;
        }
        BillingFlowParams.ProductDetailsParams.Builder p = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd);
        if (BillingClient.ProductType.SUBS.equals(pd.getProductType())) {
            List<ProductDetails.SubscriptionOfferDetails> offers = pd.getSubscriptionOfferDetails();
            if (offers == null || offers.isEmpty()) {
                fail("unavailable", "no subscription offer");
                return;
            }
            p.setOfferToken(baseOffer(offers).getOfferToken());
        } else {
            List<ProductDetails.OneTimePurchaseOfferDetails> list = pd.getOneTimePurchaseOfferDetailsList();
            if (list != null && !list.isEmpty()) p.setOfferToken(list.get(0).getOfferToken());
        }
        List<BillingFlowParams.ProductDetailsParams> plist = new ArrayList<>();
        plist.add(p.build());
        BillingFlowParams flow = BillingFlowParams.newBuilder().setProductDetailsParamsList(plist).build();
        BillingResult r = client.launchBillingFlow(activity, flow);
        if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            fail(codeName(r.getResponseCode()), r.getDebugMessage());
        }
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase p : purchases) deliver(p, true);
        } else if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            fail("canceled", "");
        } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            // An earlier purchase was never consumed: deliver it now.
            queryPurchases(false);
        } else {
            fail(codeName(code), result.getDebugMessage());
        }
    }

    private void deliver(Purchase p, boolean fresh) {
        if (!Security.verifyPurchase(BuildConfig.PLAY_LICENSE_KEY, p.getOriginalJson(), p.getSignature())) {
            Log.w(TAG, "signature verification failed for " + p.getOrderId());
            return;
        }
        List<String> ids = p.getProducts();
        for (String id : ids) {
            try {
                JSONObject j = new JSONObject();
                j.put("productId", id);
                j.put("purchaseToken", p.getPurchaseToken());
                j.put("orderId", p.getOrderId() == null ? "" : p.getOrderId());
                j.put("state", p.getPurchaseState() == Purchase.PurchaseState.PURCHASED ? "purchased"
                        : p.getPurchaseState() == Purchase.PurchaseState.PENDING ? "pending" : "unknown");
                j.put("quantity", p.getQuantity());
                j.put("acknowledged", p.isAcknowledged());
                j.put("autoRenewing", p.isAutoRenewing());
                j.put("type", subsIds.contains(id) ? "subs" : "inapp");
                j.put("fresh", fresh);
                callJs("onPurchase", JSONObject.quote(j.toString()));
            } catch (JSONException ignored) {
            }
        }
    }

    /** Called from JavaScript after the reward was stored. */
    public void finish(String token, boolean consume) {
        main.post(() -> {
            if (client == null) return;
            if (consume) {
                ConsumeParams cp = ConsumeParams.newBuilder().setPurchaseToken(token).build();
                client.consumeAsync(cp, (r, t) -> {
                    if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) Log.w(TAG, "consume failed: " + r.getDebugMessage());
                });
            } else {
                AcknowledgePurchaseParams ap = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build();
                client.acknowledgePurchase(ap, r -> {
                    if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) Log.w(TAG, "acknowledge failed: " + r.getDebugMessage());
                });
            }
        });
    }

    /** Re-delivers owned/unfinished purchases and reports active subscriptions. */
    public void queryPurchases(boolean manual) {
        main.post(() -> {
            if (client == null || !client.isReady()) {
                if (manual) fail("unavailable", "billing not ready");
                return;
            }
            final Set<String> owned = ConcurrentHashMap.newKeySet();
            final Set<String> subsActive = ConcurrentHashMap.newKeySet();
            final AtomicInteger pending = new AtomicInteger(2);
            final boolean[] ok = {true};
            for (String type : new String[]{BillingClient.ProductType.INAPP, BillingClient.ProductType.SUBS}) {
                QueryPurchasesParams qp = QueryPurchasesParams.newBuilder().setProductType(type).build();
                client.queryPurchasesAsync(qp, (r, list) -> {
                    if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        for (Purchase p : list) {
                            if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                                owned.addAll(p.getProducts());
                                if (BillingClient.ProductType.SUBS.equals(type) && !p.isSuspended()) subsActive.addAll(p.getProducts());
                                if (BillingClient.ProductType.SUBS.equals(type) && p.isSuspended()) continue;
                                deliver(p, false);
                            }
                        }
                    } else {
                        ok[0] = false;
                    }
                    if (pending.decrementAndGet() == 0) {
                        try {
                            JSONObject j = new JSONObject();
                            j.put("ok", ok[0]);
                            j.put("manual", manual);
                            j.put("owned", new JSONArray(owned));
                            j.put("subsActive", new JSONArray(subsActive));
                            callJs("onRestoreDone", JSONObject.quote(j.toString()));
                        } catch (JSONException ignored) {
                        }
                    }
                });
            }
        });
    }

    public void onResume() {
        if (client != null && client.isReady()) queryPurchases(false);
    }

    public void destroy() {
        main.post(() -> {
            if (client != null) client.endConnection();
            client = null;
        });
    }

    private void fail(String code, String msg) {
        callJs("onPurchaseFailed", JSONObject.quote(code) + "," + JSONObject.quote(msg == null ? "" : msg));
    }

    private void callJs(String fn, String args) {
        js.run("window.__ebotBilling&&window.__ebotBilling." + fn + "(" + args + ")");
    }

    private static String codeName(int code) {
        switch (code) {
            case BillingClient.BillingResponseCode.BILLING_UNAVAILABLE:
            case BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE:
            case BillingClient.BillingResponseCode.SERVICE_DISCONNECTED:
            case BillingClient.BillingResponseCode.FEATURE_NOT_SUPPORTED:
                return "unavailable";
            case BillingClient.BillingResponseCode.USER_CANCELED:
                return "canceled";
            case BillingClient.BillingResponseCode.ITEM_UNAVAILABLE:
                return "item_unavailable";
            case BillingClient.BillingResponseCode.NETWORK_ERROR:
                return "network";
            default:
                return "error";
        }
    }
}
