// Membuka blokir copy / paste / klik kanan di kolom ketik Mentari (termasuk editor "Advance").
// Dijalankan di document_start supaya listener ini terdaftar SEBELUM script halaman,
// sehingga halaman tidak bisa lagi membatalkan Ctrl+C / Ctrl+V / klik kanan di kolom ketik.
(() => {
  const TEXT_INPUT = /^(text|search|url|email|tel|password|number|)$/i;

  // Pasang ke sebuah window (halaman utama atau iframe editor). Dipasang ulang bila dokumen iframe
  // diganti lewat document.open() (dipakai CKEditor/TinyMCE), karena itu menghapus semua listener.
  function install(win) {
    const doc = win.document;
    if (!doc?.documentElement || win.__mentariUnblockDE === doc.documentElement) return;
    win.__mentariUnblockDE = doc.documentElement;
    installInto(win, doc, () => win.getSelection());
  }

  function installInto(window, document, getSelection) {
  function editableRoot(node) {
    let el = node?.nodeType === 1 ? node : node?.parentElement;
    if (!el) return null;
    if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && TEXT_INPUT.test(el.type))) return el;
    if (el.isContentEditable) {
      // naik ke elemen contenteditable paling atas (root editor)
      while (el.parentElement?.isContentEditable) el = el.parentElement;
      return el;
    }
    // iframe editor (TinyMCE / CKEditor 4): body dalam mode designMode
    if (document.designMode === "on") return document.body;
    return null;
  }
  const inEditable = (e) => editableRoot(e.target) || editableRoot(getSelection()?.anchorNode);
  const snapshot = (ed) => (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") ? ed.value : ed.innerHTML;

  function insertText(ed, text) {
    if (!text) return;
    ed.focus();
    if (document.execCommand("insertText", false, text)) return;
    if (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") {
      const start = ed.selectionStart ?? ed.value.length;
      const end = ed.selectionEnd ?? ed.value.length;
      const proto = ed.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(ed, ed.value.slice(0, start) + text + ed.value.slice(end));
      ed.selectionStart = ed.selectionEnd = start + text.length;
      ed.dispatchEvent(new window.InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }));
    }
  }

  // 1) Shortcut keyboard di kolom ketik tidak boleh dibatalkan halaman.
  //    (Ctrl+Z tidak disentuh supaya undo bawaan editor tetap jalan.)
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[acvx]$/i.test(e.key) && inEditable(e)) {
      e.stopImmediatePropagation();
    }
  }, true);

  // 2) Klik kanan & seleksi teks di kolom ketik.
  for (const type of ["contextmenu", "selectstart"]) {
    window.addEventListener(type, (e) => { if (inEditable(e)) e.stopImmediatePropagation(); }, true);
  }

  // 3) Paste: biarkan editor menangani dulu; jika halaman membatalkan paste tanpa
  //    memasukkan apa pun, sisipkan teksnya sendiri (tidak terjadi paste ganda).
  window.addEventListener("paste", (e) => {
    const ed = inEditable(e);
    if (!ed) return;
    const dt = e.clipboardData;
    const text = dt?.getData("text/plain") || "";
    if (!text) return; // paste gambar/file: serahkan ke editor
    const before = snapshot(ed);
    let handled = false;
    const fix = () => {
      if (handled) return;
      handled = true;
      if (e.defaultPrevented && snapshot(ed) === before) insertText(ed, text);
    };
    // dicek di akhir event (bubble di window); cadangan jika propagasi dihentikan halaman
    window.addEventListener("paste", fix, { once: true });
    setTimeout(fix, 30);
  }, true);

  // 4) Copy / cut: jika halaman membatalkan tanpa mengisi clipboard, isi dengan teks yang diseleksi.
  for (const type of ["copy", "cut"]) {
    window.addEventListener(type, (e) => {
      const ed = inEditable(e);
      if (!ed) return;
      const sel = ed.tagName === "TEXTAREA" || ed.tagName === "INPUT"
        ? ed.value.slice(ed.selectionStart ?? 0, ed.selectionEnd ?? 0)
        : String(getSelection() || "");
      if (!sel) return;
      let handled = false;
      const fix = (ev) => {
        if (handled) return;
        handled = true;
        if (!e.defaultPrevented) return; // copy bawaan browser berjalan normal
        const pageSet = ev ? ev.clipboardData?.getData("text/plain") : "";
        if (pageSet) return; // editor sudah mengisi clipboard sendiri
        if (ev) ev.clipboardData.setData("text/plain", sel);
        else navigator.clipboard?.writeText(sel).catch(() => {});
        if (type === "cut") document.execCommand("delete");
      };
      window.addEventListener(type, fix, { once: true });
      setTimeout(() => fix(null), 30);
    }, true);
  }

  // 5) Kolom ketik yang dibuat tidak bisa diseleksi lewat CSS.
  const style = document.createElement("style");
  style.textContent = 'textarea, input, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"] ' +
    "{ -webkit-user-select: text !important; user-select: text !important; }";
  (document.head || document.documentElement).appendChild(style);
  }

  install(window);

  // Pantau iframe editor (same-origin / about:blank) dan pasang ulang bila dokumennya berganti.
  function scanFrames() {
    for (const f of document.querySelectorAll("iframe")) {
      try { if (f.contentWindow) install(f.contentWindow); } catch { /* iframe beda origin: lewati */ }
    }
  }
  const startWatch = () => {
    scanFrames();
    new MutationObserver(scanFrames).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scanFrames, 1000);
  };
  if (document.documentElement) startWatch();
  else document.addEventListener("DOMContentLoaded", startWatch, { once: true });
})();
