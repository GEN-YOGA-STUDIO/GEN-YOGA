# ProGuard & R8 Rules for Capacitor, WebViews, and AndroidX

# Preserve Capacitor Bridge and Plugin System
-keep class com.getcapacitor.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
    @android.webkit.JavascriptInterface public *;
}

# Ignore warnings for optional Cordova classes if not present
-dontwarn org.apache.cordova.**

# Preserve WebKit interface classes
-keepclassmembers class * extends android.webkit.WebViewClient {
    public void *(android.webkit.WebView, java.lang.String);
    public void *(android.webkit.WebView, java.lang.String, android.graphics.Bitmap);
}
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public void *(android.webkit.WebView, java.lang.String);
}

# Preserve AndroidX Splash Screen & Core
-keep class androidx.core.splashscreen.** { *; }

# Preserve Line Numbers and Annotations
-keepattributes SourceFile,LineNumberTable,*Annotation*
-renamesourcefileattribute SourceFile
