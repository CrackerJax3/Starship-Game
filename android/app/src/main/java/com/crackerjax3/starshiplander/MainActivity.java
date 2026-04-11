package com.crackerjax3.starshiplander;

import android.os.Bundle;
import android.view.View;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
        // Disable overscroll rubber-band effect on the game WebView
        getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
        // Allow audio playback without requiring a user gesture (needed for game sounds)
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
