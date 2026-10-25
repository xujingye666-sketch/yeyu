package com.yeyu.app;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.ViewTreeObserver;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import android.util.Base64;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String APP_URL = "file:///android_asset/index.html";
    private static final String ASSET_CACHE_PREFERENCES = "webview_assets";
    private static final String ASSET_CACHE_VERSION_KEY = "cachedVersionCode";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private ValueCallback<Uri[]> fileCallback;
    private WebView webView;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private int fullscreenPreviousSystemUiVisibility;
    private boolean fullscreenStatusBarWasHidden;
    private volatile String pendingCardFrontendFullscreenMode = "";
    private boolean imeInsetsReportingEnabled;
    private boolean rendererRecoveryInProgress;
    private boolean activityStopped;
    private int webViewPauseEpoch;
    private int imeBaselineWebViewHeight;
    private boolean lastImeVisible;
    private int lastImeBottom = -1;
    private int lastImeViewHeight = -1;
    private int lastImeBaselineHeight = -1;
    private int statusBarInsetTop = -1;
    private int navigationBarInsetBottom = -1;
    private final Runnable imeReportRunnable = this::reportImeInsets;
    private final ViewTreeObserver.OnGlobalLayoutListener imeLayoutListener = this::scheduleImeInsetsReport;
    private static final int CARD_IMAGE_WORKERS = 3;
    private static final int CARD_IMAGE_QUEUE_CAPACITY = 6;
    private static final int CARD_IMAGE_CONNECT_TIMEOUT_MS = 15_000;
    private static final int CARD_IMAGE_READ_TIMEOUT_MS = 30_000;
    private static final long RENDERER_CRASH_WINDOW_MS = 60_000L;
    private static final int RENDERER_CRASH_LIMIT = 3;
    private final ArrayDeque<Long> rendererCrashTimes = new ArrayDeque<>();
    private final ThreadPoolExecutor imageExecutor = new ThreadPoolExecutor(
            CARD_IMAGE_WORKERS, CARD_IMAGE_WORKERS, 0L, TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<Runnable>(CARD_IMAGE_QUEUE_CAPACITY),
            new ThreadPoolExecutor.AbortPolicy());
    public final class AndroidBridge {
        @JavascriptInterface public String saveFile(String content, String name, String mime, String folder) {
            try { return performSave(content, name, mime, folder); }
            catch (Exception error) { return "ERR:" + saveFailureMessage(error); }
        }

        @JavascriptInterface public void setSystemBars(boolean light) {
            runOnUiThread(() -> {
                applySystemBarTheme(light);
                notifySystemBarInsets();
            });
        }

        @JavascriptInterface public void setCardFrontendFullscreenMode(String mode) {
            pendingCardFrontendFullscreenMode = "desktop".equals(mode) || "phone".equals(mode) ? mode : "";
        }

        @JavascriptInterface public void fetchCardImage(String url, String requestId) {
            final String source = url == null ? "" : url.trim();
            final String id = requestId == null ? "" : requestId.trim();
            CardImageDownload job = new CardImageDownload(id, source, imageGeneration);
            CardImageDownload previous = imageDownloads.put(id, job);
            if (previous != null) previous.cancel();
            try { imageExecutor.execute(job); }
            catch (RejectedExecutionException ignored) {
                imageDownloads.remove(id, job);
                runOnUiThread(() -> {
                    if (job.generation == imageGeneration)
                        notifyCardImageResult(id, "", "图片下载队列已满，请稍后重试");
                });
            }
        }

        @JavascriptInterface public void cancelCardImage(String requestId) {
            CardImageDownload job = imageDownloads.remove(requestId == null ? "" : requestId.trim());
            if (job != null) job.cancel();
        }

        // Grab feedback for long-press list reordering; the View API follows the system haptic setting and needs no permission.
        @JavascriptInterface public void hapticLongPress() {
            runOnUiThread(() -> {
                WebView target = webView;
                if (target != null) target.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
            });
        }

        @JavascriptInterface public void onWebViewPauseReady(String epochText, boolean safeToPause) {
            final int epoch;
            try { epoch = Integer.parseInt(epochText == null ? "" : epochText); }
            catch (Exception ignored) { return; }
            runOnUiThread(() -> pauseWebViewAfterPersistence(epoch, safeToPause));
        }
    }

    private static String friendlyMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? "操作失败" : message;
    }

    private static String saveFailureMessage(Exception error) {
        if (error instanceof SecurityException) return "没有写入下载目录的权限";
        if (!(error instanceof IOException)) return friendlyMessage(error);
        String detail = String.valueOf(error.getMessage());
        for (Throwable cause = error.getCause(); cause != null; cause = cause.getCause()) detail += " " + cause.getMessage();
        if (detail.contains("ENOSPC") || detail.contains("EDQUOT")) return "存储空间不足，请清理空间后重试";
        if (detail.contains("EROFS")) return "存储当前为只读，无法写入导出文件";
        return "写入导出文件失败，请检查存储后重试";
    }

    private static String safeFileName(String name) {
        String result = name == null ? "export.txt" : name.replaceAll("[^a-zA-Z0-9._\\-\\u4e00-\\u9fff]", "_");
        result = result.replaceAll("^\\.+", "_");
        if (result.isEmpty() || ".".equals(result) || "..".equals(result)) result = "export.txt";
        return result.length() > 120 ? result.substring(0, 120) : result;
    }

    private static String safeFolderName(String folder) {
        String value = folder == null ? "夜欲预设" : folder.trim();
        if (value.isEmpty()) value = "夜欲预设";
        if (".".equals(value) || "..".equals(value)
                || value.length() > 64
                || !value.matches("[a-zA-Z0-9_\\-\\u4e00-\\u9fff]+")) {
            throw new IllegalArgumentException("导出目录名无效");
        }
        return value;
    }

    private String performSave(String content, String name, String mime, String folder) throws Exception {
        String safeName = safeFileName(name);
        String safeFolder = safeFolderName(folder);
        byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);
        Uri uri = null;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + safeFolder);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("无法创建导出文件");
            try (OutputStream output = getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new IllegalStateException("无法打开导出文件");
                output.write(bytes);
            }
            ContentValues ready = new ContentValues();
            ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(uri, ready, null, null);
        } catch (Exception error) {
            if (uri != null) {
                try { getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
            }
            throw error;
        }
        return "OK:Download/" + safeFolder + "/" + savedDisplayName(uri, safeName);
    }

    // MediaStore renames on collision (e.g. "name (1).json"); report the name it actually stored.
    private String savedDisplayName(Uri uri, String requestedName) {
        try (Cursor cursor = getContentResolver().query(uri,
                new String[] {MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String stored = cursor.getString(0);
                if (stored != null && !stored.trim().isEmpty()) return stored;
            }
        } catch (Exception ignored) {}
        return requestedName;
    }

    // Match the neutral --bg-base in css/tokens.css so the system bars read as part of the page.
    private static final int INK_BACKGROUND = Color.rgb(18, 18, 18);
    private static final int PAPER_BACKGROUND = Color.rgb(246, 246, 246);

    private void applySystemBarTheme(boolean light) {
        int background = light ? PAPER_BACKGROUND : INK_BACKGROUND;
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(background);
        int visibility = getWindow().getDecorView().getSystemUiVisibility();
        visibility = light
                ? visibility | android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                : visibility & ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        visibility = light
                ? visibility | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                : visibility & ~android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(visibility);
    }

    private void updateSystemBarInsets(WindowInsets insets) {
        if (insets == null) return;
        int top = insets.getInsets(WindowInsets.Type.statusBars()).top;
        int bottom = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
        top = Math.max(0, top);
        bottom = Math.max(0, bottom);
        if (statusBarInsetTop == top && navigationBarInsetBottom == bottom) return;
        statusBarInsetTop = Math.max(0, top);
        navigationBarInsetBottom = Math.max(0, bottom);
        notifySystemBarInsets();
    }

    private void notifySystemBarInsets() {
        WebView target = webView;
        if (target == null) return;
        String script = "(function(topPx,bottomPx){var dpr=Math.max(1,Number(window.devicePixelRatio)||1),"
                + "root=document.documentElement;if(!root)return;"
                + "root.style.setProperty('--native-safe-top',Math.max(0,Math.round(topPx/dpr))+'px');"
                + "root.style.setProperty('--native-safe-bottom',Math.max(0,Math.round(bottomPx/dpr))+'px');})("
                + Math.max(0, statusBarInsetTop) + "," + Math.max(0, navigationBarInsetBottom) + ")";
        target.evaluateJavascript(script, null);
    }

    private void updateImeInsets(WindowInsets insets) {
        if (insets == null) return;
        boolean visible = insets.isVisible(WindowInsets.Type.ime());
        int bottom = visible ? Math.max(0, insets.getInsets(WindowInsets.Type.ime()).bottom) : 0;
        updateImeStateAndNotify(visible, bottom);
    }

    private void resetImeReportCache() {
        lastImeVisible = false;
        lastImeBottom = -1;
        lastImeViewHeight = -1;
        lastImeBaselineHeight = -1;
    }

    private void setImeInsetsReportingEnabled(boolean enabled) {
        if (webView == null) return;
        if (imeInsetsReportingEnabled == enabled) {
            if (enabled) scheduleImeInsetsReport();
            return;
        }
        imeInsetsReportingEnabled = enabled;
        ViewTreeObserver observer = webView.getViewTreeObserver();
        if (enabled) {
            if (observer.isAlive()) observer.addOnGlobalLayoutListener(imeLayoutListener);
            scheduleImeInsetsReport();
        } else {
            webView.removeCallbacks(imeReportRunnable);
            if (observer.isAlive()) observer.removeOnGlobalLayoutListener(imeLayoutListener);
            resetImeReportCache();
            WindowInsets insets = webView.getRootWindowInsets();
            if (insets != null) updateImeInsets(insets);
            else notifyImeInsets(false, 0, webView.getHeight(), imeBaselineWebViewHeight);
        }
    }

    private void scheduleImeInsetsReport() {
        if (!imeInsetsReportingEnabled || webView == null) return;
        webView.removeCallbacks(imeReportRunnable);
        webView.post(imeReportRunnable);
    }

    private void reportImeInsets() {
        if (!imeInsetsReportingEnabled || webView == null) return;
        boolean visible = false;
        int imeBottom = 0;
        WindowInsets insets = webView.getRootWindowInsets();
        if (insets != null) {
            visible = insets.isVisible(WindowInsets.Type.ime());
            if (visible) imeBottom = Math.max(0, insets.getInsets(WindowInsets.Type.ime()).bottom);
        }
        updateImeStateAndNotify(visible, imeBottom);
    }

    private void updateImeStateAndNotify(boolean visible, int imeBottom) {
        if (webView == null) return;
        int currentHeight = Math.max(0, webView.getHeight());
        if (!visible && currentHeight > 0) imeBaselineWebViewHeight = currentHeight;
        if (imeBaselineWebViewHeight <= 0) imeBaselineWebViewHeight = currentHeight;
        if (lastImeVisible == visible && lastImeBottom == imeBottom
                && lastImeViewHeight == currentHeight && lastImeBaselineHeight == imeBaselineWebViewHeight) return;
        lastImeVisible = visible;
        lastImeBottom = imeBottom;
        lastImeViewHeight = currentHeight;
        lastImeBaselineHeight = imeBaselineWebViewHeight;
        notifyImeInsets(visible, imeBottom, currentHeight, imeBaselineWebViewHeight);
    }

    private void notifyImeInsets(boolean visible, int imeBottom, int currentHeight, int baselineHeight) {
        if (webView == null) return;
        String script = "window.__yeyuImeInsets&&window.__yeyuImeInsets("
                + (visible ? "true" : "false") + "," + Math.max(0, imeBottom) + ","
                + Math.max(0, currentHeight) + "," + Math.max(0, baselineHeight) + ")";
        webView.evaluateJavascript(script, null);
    }

    private void notifyCardImageResult(String requestId, String data, String error) {
        if (webView == null) return;
        String script = "window.__yeyuCardImageResult&&window.__yeyuCardImageResult("
                + JSONObject.quote(requestId) + ","
                + (data != null && !data.isEmpty() ? "true" : "false") + ","
                + JSONObject.quote(data == null ? "" : data) + ","
                + JSONObject.quote(error == null ? "" : error) + ")";
        webView.evaluateJavascript(script, null);
    }

    private void flushWebViewPersistence(String reason) {
        WebView target = webView;
        if (target == null) return;
        String script = "window.flushStreamDrafts&&window.flushStreamDrafts(" + JSONObject.quote(reason)
                + ");window.flushPendingSave&&window.flushPendingSave();true";
        target.evaluateJavascript(script, null);
    }

    private void requestWebViewPauseAfterStop() {
        WebView target = webView;
        final int epoch = ++webViewPauseEpoch;
        if (target == null) return;
        if (fileCallback != null) {
            flushWebViewPersistence("native_stop");
            return;
        }
        target.evaluateJavascript("window.prepareNativeWebViewStop&&window.prepareNativeWebViewStop(" + epoch + ");true", null);
    }

    private void pauseWebViewAfterPersistence(int epoch, boolean safeToPause) {
        WebView target = webView;
        if (!safeToPause || epoch != webViewPauseEpoch || !activityStopped || target == null
                || fileCallback != null || isFinishing() || isDestroyed()) return;
        target.onPause();
        target.pauseTimers();
    }

    private static URL validateImageUrl(String value) throws Exception {
        URL parsed = new URL(value);
        String protocol = parsed.getProtocol();
        if (!("http".equalsIgnoreCase(protocol) || "https".equalsIgnoreCase(protocol))) {
            throw new IllegalArgumentException("图片地址协议不受支持");
        }
        int port = parsed.getPort();
        if (parsed.getUserInfo() != null || parsed.getHost().isEmpty() || port < -1 || port == 0 || port > 65535) {
            throw new IllegalArgumentException("图片地址无效");
        }
        parsed.toURI();
        return parsed;
    }

    private static String imageMime(String contentType, URL url) {
        String mime = contentType == null ? "" : contentType.split(";", 2)[0].trim().toLowerCase(Locale.US);
        if ("image/png".equals(mime) || "image/jpeg".equals(mime)
                || "image/webp".equals(mime) || "image/gif".equals(mime)) return mime;
        String path = url.getPath().toLowerCase(Locale.US);
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".gif")) return "image/gif";
        return "";
    }

    private static boolean imageSignature(byte[] bytes, String mime) {
        if (bytes == null || bytes.length < 4) return false;
        if ("image/png".equals(mime)) return bytes.length >= 8 && (bytes[0] & 0xff) == 0x89 && (bytes[1] & 0xff) == 0x50 && (bytes[2] & 0xff) == 0x4e && (bytes[3] & 0xff) == 0x47;
        if ("image/jpeg".equals(mime)) return (bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8 && (bytes[2] & 0xff) == 0xff;
        if ("image/gif".equals(mime)) return bytes.length >= 6 && bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == '8';
        return "image/webp".equals(mime) && bytes.length >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F' && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P';
    }

    private volatile int imageGeneration;
    private final ConcurrentHashMap<String, CardImageDownload> imageDownloads = new ConcurrentHashMap<>();

    private void cancelCardImageDownloads() {
        imageGeneration++;
        for (CardImageDownload job : imageDownloads.values()) job.cancel();
        imageDownloads.clear();
    }

    private final class CardImageDownload implements Runnable {
        final String id, source;
        final int generation;
        volatile boolean cancelled;
        volatile Thread thread;
        private HttpURLConnection connection;

        CardImageDownload(String id, String source, int generation) {
            this.id = id;
            this.source = source;
            this.generation = generation;
        }

        void cancel() {
            HttpURLConnection active;
            synchronized (this) { cancelled = true; active = connection; }
            imageExecutor.remove(this);
            Thread activeThread = thread;
            if (activeThread != null) activeThread.interrupt();
            if (active != null) active.disconnect();
        }

        synchronized void connect(HttpURLConnection active) throws InterruptedException {
            if (cancelled || generation != imageGeneration) throw new InterruptedException("图片下载已取消");
            connection = active;
        }

        synchronized void disconnected(HttpURLConnection active) {
            if (connection == active) connection = null;
        }

        @Override public void run() {
            thread = Thread.currentThread();
            String data = "", error = "";
            try {
                if (cancelled || generation != imageGeneration) return;
                data = downloadCardImage(source, this);
            } catch (SocketTimeoutException timeout) { error = "图片下载超时，请稍后重试"; }
            catch (Exception failure) { error = friendlyMessage(failure); }
            finally {
                thread = null;
                if (cancelled || generation != imageGeneration) imageDownloads.remove(id, this);
            }
            final String result = data, message = error;
            runOnUiThread(() -> {
                if (imageDownloads.remove(id, this) && !cancelled && generation == imageGeneration)
                    notifyCardImageResult(id, result, message);
            });
        }
    }

    private static String downloadCardImage(String source, CardImageDownload job) throws Exception {
        URL current = validateImageUrl(source);
        for (int redirect = 0; redirect < 4; redirect++) {
            HttpURLConnection connection = (HttpURLConnection) current.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(CARD_IMAGE_CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(CARD_IMAGE_READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "image/png,image/jpeg,image/webp,image/gif");
            connection.setRequestProperty("User-Agent", "Yeyu/1.0");
            try {
                job.connect(connection);
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) throw new IllegalStateException("图片重定向地址为空");
                    current = validateImageUrl(new URL(current, location).toString());
                    continue;
                }
                if (status < 200 || status >= 300) throw new IllegalStateException("图片请求失败 HTTP " + status);
                String mime = imageMime(connection.getContentType(), current);
                if (mime.isEmpty()) throw new IllegalArgumentException("图片格式不是 PNG/JPEG/WebP/GIF");
                int length = connection.getContentLength();
                ByteArrayOutputStream output = new ByteArrayOutputStream(Math.max(1024, Math.min(length > 0 ? length : 65536, 65536)));
                byte[] buffer = new byte[8192];
                int read;
                try (java.io.InputStream input = connection.getInputStream()) {
                    while ((read = input.read(buffer)) != -1) {
                        if (job.cancelled) throw new InterruptedException("图片下载已取消");
                        output.write(buffer, 0, read);
                    }
                }
                byte[] bytes = output.toByteArray();
                if (!imageSignature(bytes, mime)) throw new IllegalArgumentException("图片内容损坏，无法读取");
                // Decode only a validation thumbnail; keep the downloaded bytes unchanged.
                Bitmap bitmap = ImageDecoder.decodeBitmap(
                    ImageDecoder.createSource(java.nio.ByteBuffer.wrap(bytes)),
                    (decoder, info, imageSource) -> {
                        decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                        decoder.setTargetSampleSize(Math.max(info.getSize().getWidth(), info.getSize().getHeight()));
                    });
                bitmap.recycle();
                if (job.cancelled) throw new InterruptedException("图片下载已取消");
                return "data:" + mime + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
            } finally {
                connection.disconnect();
                job.disconnected(connection);
            }
        }
        throw new IllegalStateException("图片重定向次数过多");
    }

    private final class AppWebViewClient extends WebViewClient {
        @Override public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (isInternalWebViewUrl(url)) {
                notifySystemBarInsets();
                updateImeInsets(view.getRootWindowInsets());
            }
        }

        private boolean openExternal(Uri uri) {
            String scheme = uri == null ? null : uri.getScheme();
            if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                return true;
            }
            if ("file".equalsIgnoreCase(scheme)) return !isInternalWebViewUrl(uri.toString());
            return true;
        }

        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return true;
            return openExternal(request.getUrl());
        }

        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            recoverWebViewAfterRendererGone(view, detail.didCrash());
            return true;
        }
    }

    private void showFullscreenView(View view, WebChromeClient.CustomViewCallback callback) {
        if (view == null || view.getParent() != null || fullscreenView != null) {
            pendingCardFrontendFullscreenMode = "";
            if (callback != null) callback.onCustomViewHidden();
            return;
        }
        String cardFrontendMode = pendingCardFrontendFullscreenMode;
        pendingCardFrontendFullscreenMode = "";
        View decor = getWindow().getDecorView();
        fullscreenView = view;
        fullscreenCallback = callback;
        fullscreenPreviousSystemUiVisibility = decor.getSystemUiVisibility();
        fullscreenStatusBarWasHidden = (getWindow().getAttributes().flags
                & WindowManager.LayoutParams.FLAG_FULLSCREEN) != 0;
        ((ViewGroup) decor).addView(view, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (webView != null) webView.setVisibility(View.INVISIBLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        decor.setSystemUiVisibility(fullscreenPreviousSystemUiVisibility
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        setRequestedOrientation("phone".equals(cardFrontendMode)
                ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        view.requestFocus();
    }

    private void hideFullscreenView() {
        View activeView = fullscreenView;
        if (activeView == null) return;
        pendingCardFrontendFullscreenMode = "";
        fullscreenView = null;
        fullscreenCallback = null;
        if (activeView.getParent() instanceof ViewGroup) {
            ((ViewGroup) activeView.getParent()).removeView(activeView);
        }
        if (webView != null) webView.setVisibility(View.VISIBLE);
        if (!fullscreenStatusBarWasHidden) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        }
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(fullscreenPreviousSystemUiVisibility);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        decor.requestApplyInsets();
        if (webView != null) webView.requestApplyInsets();
    }

    private void requestFullscreenExit() {
        WebChromeClient.CustomViewCallback callback = fullscreenCallback;
        fullscreenCallback = null;
        if (callback != null) callback.onCustomViewHidden();
    }

    private WebView createConfiguredWebView() {
        WebView view = new WebView(this);
        view.setBackgroundColor(INK_BACKGROUND);
        view.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        view.setVerticalScrollBarEnabled(false);
        view.setHorizontalScrollBarEnabled(false);
        view.setOnApplyWindowInsetsListener((target, insets) -> {
            updateSystemBarInsets(insets);
            updateImeInsets(insets);
            return insets;
        });
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        // The bundled file page and its card frames call user-selected providers without requiring CORS.
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        view.setWebViewClient(new AppWebViewClient());
        view.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        view.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View customView, CustomViewCallback callback) {
                showFullscreenView(customView, callback);
            }

            @Override public void onHideCustomView() {
                hideFullscreenView();
            }

            @Override public boolean onShowFileChooser(WebView ignoredView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception error) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器：" + friendlyMessage(error), Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
        return view;
    }

    private static String withoutQueryAndFragment(String url) {
        return url == null ? "" : url.split("#", 2)[0].split("\\?", 2)[0];
    }

    private boolean isInternalWebViewUrl(String url) {
        String page = withoutQueryAndFragment(url);
        return APP_URL.equals(page);
    }

    private PackageInfo installedPackageInfo() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0);
        } catch (PackageManager.NameNotFoundException error) {
            return null;
        }
    }

    private long installedVersionCode() {
        PackageInfo info = installedPackageInfo();
        return info == null ? 0L : info.getLongVersionCode();
    }

    // Bundled assets are addressed without cache keys; the first launch of a new versionCode drops the
    // resource cache once so stale copies of a previous install never outlive the upgrade.
    private void clearWebViewCacheAfterUpgrade(WebView view) {
        SharedPreferences preferences = getSharedPreferences(ASSET_CACHE_PREFERENCES, MODE_PRIVATE);
        long current = installedVersionCode();
        if (preferences.getLong(ASSET_CACHE_VERSION_KEY, -1L) == current) return;
        view.clearCache(true);
        preferences.edit().putLong(ASSET_CACHE_VERSION_KEY, current).apply();
    }

    private String installedVersionName() {
        PackageInfo info = installedPackageInfo();
        return info == null || info.versionName == null ? "" : info.versionName;
    }

    // The page shows this versionName and compares it with published releases.
    private String appUrlWithVersion() {
        return APP_URL + "?version=" + Uri.encode(installedVersionName());
    }

    private void attachFreshWebView() {
        WebView fresh = createConfiguredWebView();
        webView = fresh;
        setImeInsetsReportingEnabled(true);
        // pauseTimers() is process-wide and may outlive the WebView that paused it.
        fresh.resumeTimers();
        setContentView(fresh);
        clearWebViewCacheAfterUpgrade(fresh);
        fresh.loadUrl(appUrlWithVersion());
        fresh.post(() -> {
            if (webView == fresh && fresh.getHeight() > 0) imeBaselineWebViewHeight = fresh.getHeight();
        });
    }

    private void clearImeStateForLostWebView(WebView lostView) {
        if (lostView != null) {
            lostView.removeCallbacks(imeReportRunnable);
            ViewTreeObserver observer = lostView.getViewTreeObserver();
            if (observer.isAlive()) observer.removeOnGlobalLayoutListener(imeLayoutListener);
        }
        imeInsetsReportingEnabled = false;
        imeBaselineWebViewHeight = 0;
        resetImeReportCache();
    }

    private void removeRendererGoneWebView(WebView lostView, boolean activeWebView) {
        if (lostView == null) return;
        if (activeWebView) {
            cancelCardImageDownloads();
            clearImeStateForLostWebView(lostView);
        }
        else lostView.removeCallbacks(imeReportRunnable);
        if (lostView.getParent() instanceof ViewGroup) ((ViewGroup) lostView.getParent()).removeView(lostView);
        try { lostView.destroy(); } catch (Exception ignored) {}
    }

    // Crashes (not system reclaims) inside a short window mean the restored page itself is killing the
    // renderer; stop rebuilding so the user is not trapped in a crash loop.
    private boolean rendererCrashLoopDetected() {
        long now = SystemClock.elapsedRealtime();
        rendererCrashTimes.addLast(now);
        while (!rendererCrashTimes.isEmpty() && now - rendererCrashTimes.peekFirst() > RENDERER_CRASH_WINDOW_MS)
            rendererCrashTimes.removeFirst();
        return rendererCrashTimes.size() >= RENDERER_CRASH_LIMIT;
    }

    private void showRendererCrashLoopPanel() {
        float density = getResources().getDisplayMetrics().density;
        int padding = Math.round(24 * density);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setBackgroundColor(INK_BACKGROUND);
        panel.setFitsSystemWindows(true);
        panel.setPadding(padding, padding, padding, padding);
        TextView title = new TextView(this);
        title.setText("网页组件连续崩溃，已停止自动重启");
        title.setTextColor(PAPER_BACKGROUND);
        title.setTextSize(18);
        title.setGravity(Gravity.CENTER);
        TextView body = new TextView(this);
        body.setText("可能是当前会话或卡片内容导致。可以点击重新加载再试一次；如仍崩溃，请重新打开应用。");
        body.setTextColor(Color.rgb(170, 170, 170));
        body.setTextSize(14);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, Math.round(12 * density), 0, Math.round(20 * density));
        Button reload = new Button(this);
        reload.setText("重新加载");
        reload.setOnClickListener(ignored -> {
            try { attachFreshWebView(); }
            catch (Exception error) {
                Toast.makeText(this, "网页组件恢复失败，请重新打开应用", Toast.LENGTH_LONG).show();
            }
        });
        panel.addView(title);
        panel.addView(body);
        panel.addView(reload, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(panel);
    }

    private void recoverWebViewAfterRendererGone(WebView lostView, boolean crashed) {
        if (lostView == null || rendererRecoveryInProgress) return;
        rendererRecoveryInProgress = true;
        try {
            boolean wasActiveWebView = lostView == webView;
            if (wasActiveWebView && fullscreenView != null) hideFullscreenView();
            if (wasActiveWebView) completeFileChooser(null);
            removeRendererGoneWebView(lostView, wasActiveWebView);
            if (!wasActiveWebView) return;
            webView = null;
            if (isFinishing() || isDestroyed()) return;
            if (crashed && rendererCrashLoopDetected()) {
                showRendererCrashLoopPanel();
                return;
            }
            try {
                attachFreshWebView();
                Toast.makeText(this, "网页组件已重新启动；如生成被中断，可在恢复卡片中处理已保存内容", Toast.LENGTH_LONG).show();
            } catch (Exception ignored) {
                Toast.makeText(this, "网页组件恢复失败，请重新打开应用", Toast.LENGTH_LONG).show();
            }
        } finally {
            rendererRecoveryInProgress = false;
        }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled(true);
        getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        getWindow().setStatusBarColor(INK_BACKGROUND);
        getWindow().setNavigationBarColor(INK_BACKGROUND);
        attachFreshWebView();
    }

    private void completeFileChooser(Uri[] result) {
        if (fileCallback == null) return;
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_CHOOSER_REQUEST && fileCallback != null) {
            completeFileChooser(WebChromeClient.FileChooserParams.parseResult(result, data));
        }
    }

    @Override public void onBackPressed() {
        if (fullscreenView != null) { requestFullscreenExit(); return; }
        if (webView == null) { super.onBackPressed(); return; }
        webView.evaluateJavascript("(window.handleNativeBack&&window.handleNativeBack())?'1':'0'", value -> {
            if (!"\"1\"".equals(value) && !"1".equals(value)) {
                MainActivity.super.onBackPressed();
            }
        });
    }

    @Override protected void onPause() {
        flushWebViewPersistence("native_pause");
        super.onPause();
    }

    @Override protected void onStop() {
        activityStopped = true;
        requestWebViewPauseAfterStop();
        super.onStop();
    }

    @Override protected void onResume() {
        super.onResume();
        activityStopped = false;
        webViewPauseEpoch++;
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume();
        }
    }

    @Override protected void onDestroy() {
        activityStopped = true;
        webViewPauseEpoch++;
        if (fullscreenView != null) hideFullscreenView();
        completeFileChooser(null);
        cancelCardImageDownloads();
        imageExecutor.shutdownNow();
        if (webView != null) {
            setImeInsetsReportingEnabled(false);
            webView.resumeTimers();
            webView.removeJavascriptInterface("AndroidBridge"); webView.destroy(); webView = null;
        }
        super.onDestroy();
    }
}
