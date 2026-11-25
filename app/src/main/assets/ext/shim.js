// Shim API chrome.* untuk menjalankan kode extension Mentari Assistant di dalam WebView Android.
// - chrome.storage.local  -> disimpan di SharedPreferences lewat jembatan MentariAndroid
// - chrome.runtime        -> pesan antara content.js dan background.js di halaman yang sama
// - fetch ke Groq/ClassAI/DeepSeek -> dikerjakan oleh Kotlin (API key ditambahkan di sisi Kotlin,
//                            tidak pernah terlihat oleh JavaScript halaman)
// PENTING: tidak ada objek bawaan browser yang diubah (window.fetch / window.chrome tetap asli),
// karena verifikasi Cloudflare memeriksanya. API ini hanya diberikan ke kode extension
// lewat window.__mentariApi (dibungkus oleh MainActivity).
(() => {
  if (window.__mentariShim) return;
  window.__mentariShim = true;
  const bridge = window.MentariAndroid;
  if (!bridge) return;

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  let store = {};
  try { store = JSON.parse(bridge.storageGetAll() || "{}"); } catch { store = {}; }

  // ---------------------------------------------------------------- chrome.storage
  const changeListeners = [];
  function emitChanges(changes) {
    if (!Object.keys(changes).length) return;
    changeListeners.forEach((fn) => { try { fn(changes, "local"); } catch (e) { console.error(e); } });
  }
  function pick(keys) {
    if (keys == null) return clone(store);
    const out = {};
    if (typeof keys === "string") keys = [keys];
    if (Array.isArray(keys)) {
      keys.forEach((k) => { if (k in store) out[k] = clone(store[k]); });
    } else if (typeof keys === "object") {
      for (const k in keys) out[k] = k in store ? clone(store[k]) : keys[k];
    }
    return out;
  }
  const local = {
    get(keys, cb) {
      const res = pick(keys);
      if (typeof cb === "function") setTimeout(() => cb(res), 0);
      return Promise.resolve(res);
    },
    set(items, cb) {
      const changes = {};
      for (const k in items) {
        changes[k] = { oldValue: clone(store[k]), newValue: clone(items[k]) };
        store[k] = clone(items[k]);
      }
      try { bridge.storageSet(JSON.stringify(items)); } catch (e) { console.error(e); }
      emitChanges(changes);
      if (typeof cb === "function") setTimeout(cb, 0);
      return Promise.resolve();
    },
    remove(keys, cb) {
      if (typeof keys === "string") keys = [keys];
      const changes = {};
      (keys || []).forEach((k) => {
        if (k in store) { changes[k] = { oldValue: clone(store[k]) }; delete store[k]; }
      });
      try { bridge.storageRemove(JSON.stringify(keys || [])); } catch (e) { console.error(e); }
      emitChanges(changes);
      if (typeof cb === "function") setTimeout(cb, 0);
      return Promise.resolve();
    }
  };
  // Dipanggil Kotlin setelah halaman Pengaturan disimpan.
  window.__mentariStorageRefresh = (json) => {
    let next = {};
    try { next = JSON.parse(json || "{}"); } catch { return; }
    const changes = {};
    const keys = new Set([...Object.keys(store), ...Object.keys(next)]);
    keys.forEach((k) => {
      if (JSON.stringify(store[k]) !== JSON.stringify(next[k])) changes[k] = { oldValue: store[k], newValue: next[k] };
    });
    store = next;
    emitChanges(changes);
  };

  // ---------------------------------------------------------------- chrome.runtime
  const msgListeners = [];
  const runtime = {
    id: "android",
    onMessage: { addListener(fn) { msgListeners.push(fn); } },
    onInstalled: { addListener(fn) { setTimeout(() => { try { fn({ reason: "update" }); } catch (e) { console.error(e); } }, 0); } },
    onStartup: { addListener() {} },
    getURL(p) { return p; },
    openOptionsPage() { try { bridge.openSettings(); } catch (e) { console.error(e); } },
    sendMessage(msg, cb) {
      return new Promise((resolve) => {
        let done = false;
        let isAsync = false;
        const respond = (r) => {
          if (done) return;
          done = true;
          resolve(r);
          if (typeof cb === "function") cb(r);
        };
        // Sama seperti extension: listener dijalankan terpisah dari pemanggil.
        setTimeout(() => {
          for (const fn of msgListeners) {
            try { if (fn(msg, { id: "android" }, respond) === true) isAsync = true; } catch (e) { console.error(e); }
          }
          if (!isAsync) respond(undefined);
        }, 0);
      });
    }
  };

  const chromeApi = { storage: { local, onChanged: { addListener(fn) { changeListeners.push(fn); } } }, runtime };

  // ---------------------------------------------------------------- fetch AI lewat Kotlin
  const AI_HOSTS = /^https:\/\/(api\.groq\.com|router\.classai\.id|api\.deepseek\.com)\//i;
  const pending = new Map();
  let seq = 0;
  window.__mentariHttpCb = (id, status, body) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (status <= 0) p.reject(new TypeError(body || "Gagal terhubung ke server AI"));
    else p.resolve(new Response(body, { status, headers: { "Content-Type": "application/json" } }));
  };
  const nativeFetch = window.fetch.bind(window);
  const aiFetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    if (!AI_HOSTS.test(url)) return nativeFetch(input, init);
    return new Promise((resolve, reject) => {
      const id = "h" + (++seq) + "_" + Date.now();
      pending.set(id, { resolve, reject });
      const headers = {};
      new Headers(init.headers || {}).forEach((v, k) => { if (k.toLowerCase() !== "authorization") headers[k] = v; });
      try {
        bridge.http(id, url, init.method || "GET", JSON.stringify(headers), typeof init.body === "string" ? init.body : "");
      } catch (e) {
        pending.delete(id);
        reject(e);
      }
    });
  };

  Object.defineProperty(window, "__mentariApi", {
    value: Object.freeze({ chrome: chromeApi, fetch: aiFetch }),
    enumerable: false
  });
})();
