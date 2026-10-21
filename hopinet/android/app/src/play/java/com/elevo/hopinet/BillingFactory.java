package com.elevo.hopinet;

import android.content.Context;

/** "play" edition: real Google Play Billing. */
final class BillingFactory {
    private BillingFactory() {
    }

    static BillingController create(Context context, JsSink js) {
        return new BillingManager(context, js);
    }
}
