package com.ebot.goldchase;

import android.text.TextUtils;
import android.util.Base64;
import android.util.Log;

import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;

/**
 * Optional on-device verification of Google Play purchase signatures using the app's
 * Base64-encoded RSA public key from Play Console. When no key is configured the check is
 * skipped. For production anti-fraud, also verify purchase tokens on a server with the
 * Google Play Developer API (purchases.products / purchases.subscriptionsv2).
 */
final class Security {
    private static final String TAG = "EbotSecurity";

    private Security() {
    }

    static boolean verifyPurchase(String base64PublicKey, String signedData, String signature) {
        if (TextUtils.isEmpty(base64PublicKey)) return true;
        if (TextUtils.isEmpty(signedData) || TextUtils.isEmpty(signature)) return false;
        try {
            byte[] keyBytes = Base64.decode(base64PublicKey, Base64.DEFAULT);
            PublicKey key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(keyBytes));
            Signature sig = Signature.getInstance("SHA1withRSA");
            sig.initVerify(key);
            sig.update(signedData.getBytes("UTF-8"));
            return sig.verify(Base64.decode(signature, Base64.DEFAULT));
        } catch (Exception e) {
            Log.w(TAG, "verification error", e);
            return false;
        }
    }
}
