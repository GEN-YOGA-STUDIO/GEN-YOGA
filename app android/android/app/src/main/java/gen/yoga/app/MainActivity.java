package gen.yoga.app;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();

            // 1. Aceleración por hardware dedicada en la capa WebView
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

            // 2. Eliminar overscroll para evitar tirones en el desplazamiento web
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

            WebSettings settings = webView.getSettings();

            // 3. Almacenamiento local optimizado para datos y estado de usuario
            settings.setDomStorageEnabled(true);

            // 4. Modo de caché optimizado para velocidad de carga
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);

            // 5. Reproducción de sesiones de yoga sin bloqueo por gesto previo
            settings.setMediaPlaybackRequiresUserGesture(false);

            // 6. Optimización de viewport
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);

            // 7. Acceso a contenido local seguro
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
        }
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        // Liberar recursos de caché en segundo plano si el sistema notifica presión de memoria
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().clearCache(false);
        }
    }
}
