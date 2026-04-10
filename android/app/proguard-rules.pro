# ── Capacitor WebView bridge ──────────────────────────────────────────────────
# Keeps all @JavascriptInterface methods so the JS↔Java bridge works after R8.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# Keep Capacitor plugin classes
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-dontwarn com.getcapacitor.**

# ── Google Mobile Ads (AdMob) ─────────────────────────────────────────────────
-keep class com.google.android.gms.ads.** { *; }
-keep class com.google.ads.** { *; }
-dontwarn com.google.android.gms.ads.**

# ── Google UMP / Consent SDK ──────────────────────────────────────────────────
-keep class com.google.android.ump.** { *; }
-dontwarn com.google.android.ump.**

# ── Firebase / Firestore (leaderboard) ───────────────────────────────────────
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# ── Preserve line numbers in crash reports ────────────────────────────────────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
