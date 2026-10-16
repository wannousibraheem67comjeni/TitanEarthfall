# Methods called from JavaScript must survive R8.
-keepattributes JavascriptInterface
-keepclassmembers class com.ebot.goldchase.EbotBridge {
    @android.webkit.JavascriptInterface <methods>;
}
