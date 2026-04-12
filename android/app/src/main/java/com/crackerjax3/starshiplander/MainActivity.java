package com.crackerjax3.starshiplander;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Enable edge-to-edge display (required for Android 15 / SDK 35)
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
        // Use LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS (SHORT_EDGES deprecated in SDK 35)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        // Disable overscroll rubber-band effect on the game WebView
        getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
        // Allow audio playback without requiring a user gesture (needed for game sounds)
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
