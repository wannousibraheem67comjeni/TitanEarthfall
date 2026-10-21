# Methods called from JavaScript must survive R8.
-keepattributes JavascriptInterface
-keepclassmembers class com.elevo.hopinet.HopinetBridge {
    @android.webkit.JavascriptInterface <methods>;
}
