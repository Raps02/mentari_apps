package com.unpam.mentari.assistant

import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * WebView yang membuka Mentari dan menjalankan kode extension "Mentari UNPAM Assistant"
 * (content.js, background.js, unblock.js, pastemain.js) tanpa perubahan, lewat shim.js.
 */
class MainActivity : Activity() {

    companion object {
        const val HOME_URL = "https://mentari.unpam.ac.id"
        private const val FILE_CHOOSER_REQUEST = 1001
        private val AI_HOSTS = setOf("api.groq.com", "router.classai.id", "api.deepseek.com")
    }

    private lateinit var webView: WebView
    private val io = Executors.newCachedThreadPool()
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var docStartSupported = false
    @Volatile private var currentHost: String = ""
    private val main = Handler(Looper.getMainLooper())
    private lateinit var overlay: LinearLayout
    private lateinit var overlayText: TextView
    private var autoReloads = 0

    private lateinit var startBundle: String
    private lateinit var contentBundle: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        webView = WebView(this)
        val root = FrameLayout(this)
        root.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(buildOverlay(), FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        buildBundles()
        setupWebView()

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(HOME_URL)

        // Pertama kali dibuka dan belum ada API key sama sekali: langsung buka Pengaturan.
        val secrets = Store.secrets(this)
        if (!secrets.getBoolean("askedOnce", false) && Store.groqKey(this).isEmpty() &&
            Store.classaiKey(this).isEmpty() && Store.deepseekKey(this).isEmpty()) {
            secrets.edit().putBoolean("askedOnce", true).apply()
            startActivity(Intent(this, SettingsActivity::class.java))
        }
    }

    // ------------------------------------------------------------------ script extension
    private fun asset(name: String): String =
        assets.open("ext/$name").bufferedReader(Charsets.UTF_8).use(BufferedReader::readText)

    private fun buildBundles() {
        val shim = asset("shim.js")
        val background = asset("background.js")
            .replace("Klik ikon extension untuk mengisinya.", "Buka ☰ Fitur lain → ⚙️ Pengaturan untuk mengisinya.")
        val pasteMain = asset("pastemain.js")
        val unblock = asset("unblock.js")
        val content = asset("content.js")
        // Halaman verifikasi Cloudflare: jangan jalankan fitur apa pun di sana.
        val notChallenge = "!(document.title === 'Just a moment...' || window._cf_chl_opt || location.pathname.indexOf('/cdn-cgi/') === 0)"

        // Berjalan sejak awal dokumen (seperti content script run_at: document_start).
        startBundle = buildString {
            append(shim).append("\n;\n")
            append(pasteMain).append("\n;\n")
            append(unblock).append("\n;\n")
            // background.js hanya di halaman utama, dibungkus agar aman bila disuntik dua kali.
            append("if (window.top === window && window.__mentariApi && !window.__mentariBg) { window.__mentariBg = true; (function(chrome, fetch){\n")
            append(background)
            append("\n})(window.__mentariApi.chrome, window.__mentariApi.fetch); }\n")
        }
        // content.js (UI & fitur) setelah DOM siap, hanya di halaman utama.
        contentBundle = buildString {
            append("(function(){ if (window.top !== window || !window.__mentariApi) return; function __run(){ if (!($notChallenge)) return;\n")
            append("(function(chrome){\n")
            append(content)
            append("\n})(window.__mentariApi.chrome);\n")
            append("\n} if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __run, { once: true }); else __run(); })();\n")
        }
    }

    private fun setupWebView() {
        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.loadWithOverviewMode = true
        s.useWideViewPort = true
        s.builtInZoomControls = true
        s.displayZoomControls = false
        s.mediaPlaybackRequiresUserGesture = false
        s.javaScriptCanOpenWindowsAutomatically = true
        s.setSupportMultipleWindows(false)
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        // User-Agent asli WebView sengaja TIDAK diubah: UA palsu tidak cocok dengan engine WebView
        // dan bisa membuat verifikasi Cloudflare gagal (layar putih).

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.addJavascriptInterface(Bridge(), "MentariAndroid")

        val all = "$startBundle\n$contentBundle"
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            docStartSupported = true
            WebViewCompat.addDocumentStartJavaScript(webView, all, setOf("https://mentari.unpam.ac.id"))
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                val host = uri.host ?: return false
                if (uri.scheme == "https" && (host.endsWith("unpam.ac.id") || host.endsWith("cloudflare.com"))) return false
                // Link luar (YouTube, Google Drive, WhatsApp, dll.) dibuka di aplikasi lain.
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    true
                } catch (e: Exception) {
                    false
                }
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                currentHost = Uri.parse(url ?: "").host ?: ""
                hideOverlay()
                if (!docStartSupported && isMentari(url)) view.evaluateJavascript(startBundle, null)
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                currentHost = Uri.parse(url ?: "").host ?: ""
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (!docStartSupported && isMentari(url)) view.evaluateJavascript(all, null)
                CookieManager.getInstance().flush()
                scheduleBlankCheck()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    showOverlay("Halaman gagal dimuat (${error.description}). Periksa koneksi lalu muat ulang.")
                }
            }

            // Proses WebView mati (mis. kehabisan memori): buat ulang activity, jangan biarkan layar putih.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    val intent = params.createIntent().apply {
                        if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                    startActivityForResult(Intent.createChooser(intent, "Pilih file"), FILE_CHOOSER_REQUEST)
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    Toast.makeText(this@MainActivity, "Tidak bisa membuka pemilih file", Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }

        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
                val req = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                    addRequestHeader("User-Agent", userAgent)
                    setTitle(name)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                }
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                Toast.makeText(this, "Mengunduh $name", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) {}
            }
        }
    }

    private fun isMentari(url: String?): Boolean = Uri.parse(url ?: "").host == "mentari.unpam.ac.id"

    // ------------------------------------------------------------------ jembatan JS <-> Kotlin
    inner class Bridge {
        @JavascriptInterface
        fun storageGetAll(): String = Store.dataForJs(this@MainActivity).toString()

        @JavascriptInterface
        fun storageSet(json: String) {
            try { Store.merge(this@MainActivity, JSONObject(json)) } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun storageRemove(json: String) {
            try { Store.remove(this@MainActivity, JSONArray(json)) } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun openSettings() {
            runOnUiThread { startActivity(Intent(this@MainActivity, SettingsActivity::class.java)) }
        }

        /** Request ke Groq / ClassAI / DeepSeek. API key ditambahkan di sini, tidak pernah dikirim ke JavaScript. */
        @JavascriptInterface
        fun http(id: String, url: String, method: String, headersJson: String, body: String) {
            val target = try { URL(url) } catch (e: Exception) { null }
            if (target == null || target.protocol != "https" || target.host !in AI_HOSTS || currentHost != "mentari.unpam.ac.id") {
                deliver(id, 0, "Request ditolak")
                return
            }
            io.execute {
                var conn: HttpURLConnection? = null
                try {
                    conn = (target.openConnection() as HttpURLConnection).apply {
                        requestMethod = method.uppercase()
                        connectTimeout = 20000
                        readTimeout = 120000
                        val headers = try { JSONObject(headersJson) } catch (_: Exception) { JSONObject() }
                        headers.keys().forEach { k -> setRequestProperty(k, headers.optString(k)) }
                        val key = when (target.host) {
                            "api.groq.com" -> Store.groqKey(this@MainActivity)
                            "api.deepseek.com" -> Store.deepseekKey(this@MainActivity)
                            else -> Store.classaiKey(this@MainActivity)
                        }
                        if (key.isNotEmpty()) setRequestProperty("Authorization", "Bearer $key")
                        if (body.isNotEmpty() && requestMethod != "GET") {
                            doOutput = true
                            outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                        }
                    }
                    val code = conn.responseCode
                    val stream = if (code >= 400) conn.errorStream else conn.inputStream
                    val text = stream?.bufferedReader(Charsets.UTF_8)?.use(BufferedReader::readText) ?: ""
                    deliver(id, code, text)
                } catch (e: Exception) {
                    deliver(id, 0, e.message ?: "Gagal terhubung ke server AI")
                } finally {
                    conn?.disconnect()
                }
            }
        }
    }

    private fun deliver(id: String, status: Int, body: String) {
        val js = "window.__mentariHttpCb && window.__mentariHttpCb(${JSONObject.quote(id)}, $status, ${JSONObject.quote(body)})"
        runOnUiThread { webView.evaluateJavascript(js, null) }
    }

    // ------------------------------------------------------------------ layar putih / gagal muat
    private fun buildOverlay(): View {
        overlayText = TextView(this).apply {
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(48, 0, 48, 32)
        }
        val reload = Button(this).apply {
            text = "⟳ Muat ulang"
            setOnClickListener { autoReloads = 0; hideOverlay(); webView.reload() }
        }
        val home = Button(this).apply {
            text = "Ke beranda Mentari"
            setOnClickListener { autoReloads = 0; hideOverlay(); webView.loadUrl(HOME_URL) }
        }
        overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(0xF2FFFFFF.toInt())
            visibility = View.GONE
            isClickable = true
            addView(overlayText)
            addView(reload)
            addView(home)
        }
        return overlay
    }

    private fun showOverlay(message: String) {
        overlayText.text = message
        overlay.visibility = View.VISIBLE
    }

    private fun hideOverlay() {
        if (::overlay.isInitialized) overlay.visibility = View.GONE
    }

    /** Beberapa detik setelah halaman selesai dimuat: jika masih kosong (putih), muat ulang sekali, lalu tampilkan tombol. */
    private fun scheduleBlankCheck() {
        main.removeCallbacksAndMessages("blank")
        main.postAtTime({
            val js = "(function(){var b=document.body;if(!b)return 0;return (b.innerText||'').trim().length+document.querySelectorAll('iframe,img,canvas,video').length;})()"
            webView.evaluateJavascript(js) { res ->
                val size = res?.toIntOrNull() ?: 0
                if (size > 0) { autoReloads = 0; return@evaluateJavascript }
                if (autoReloads < 1) {
                    autoReloads++
                    webView.reload()
                } else {
                    showOverlay("Halaman Mentari kosong. Biasanya karena verifikasi Cloudflare belum selesai.")
                }
            }
        }, "blank", android.os.SystemClock.uptimeMillis() + 7000)
    }

    // ------------------------------------------------------------------ lifecycle
    override fun onResume() {
        super.onResume()
        // Kirim pengaturan terbaru (mis. setelah halaman Pengaturan disimpan) ke halaman.
        val json = JSONObject.quote(Store.dataForJs(this).toString())
        webView.evaluateJavascript("window.__mentariStorageRefresh && window.__mentariStorageRefresh($json)", null)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                ?: data?.clipData?.let { clip -> Array(clip.itemCount) { clip.getItemAt(it).uri } })
            fileCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        io.shutdownNow()
        webView.destroy()
        super.onDestroy()
    }
}
