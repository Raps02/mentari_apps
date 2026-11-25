// Berjalan di "MAIN world" halaman Mentari, paling awal (document_start).
// Editor "Advance" Mentari (CKEditor 5 / TinyMCE) memblokir paste ("Paste tidak diperbolehkan!").
// Script ini mengambil alih event paste SEBELUM editor/halaman melihatnya, lalu memasukkan teksnya
// lewat API resmi editor, sehingga pemblokir tidak terpicu dan isi editor benar-benar tersimpan.
(() => {
  if (window.__mentariPasteMain) return;
  window.__mentariPasteMain = true;

  const TEXT_INPUT = /^(text|search|url|email|tel|password|number|)$/i;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const textToHtml = (t) => String(t).replace(/\r\n?/g, "\n").split(/\n{2,}/)
    .map((p) => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("");

  function ckOf(el) {
    const root = el?.closest?.(".ck-editor__editable, .ck-content[contenteditable]");
    return root?.ckeditorInstance || null;
  }
  function tinyOf(el) {
    const tm = window.tinymce;
    if (!tm || !el) return null;
    const list = (typeof tm.get === "function" ? tm.get() : null) || tm.editors || [];
    return [...list].find((ed) => {
      const body = ed?.getBody?.();
      return body && (body === el || body.contains(el) || body.ownerDocument === (el.ownerDocument || el));
    }) || null;
  }

  // Masukkan html lewat API editor. replace=true mengganti seluruh isi editor.
  function insertViaEditor(el, html, replace) {
    const ck = ckOf(el);
    if (ck) {
      if (replace) ck.setData(html);
      else ck.model.insertContent(ck.data.toModel(ck.data.processor.toView(html)));
      ck.editing.view.focus();
      return true;
    }
    const tiny = tinyOf(el);
    if (tiny) {
      if (replace) tiny.setContent(html); else tiny.insertContent(html);
      tiny.fire?.("input");
      tiny.fire?.("change");
      tiny.save?.();
      return true;
    }
    return false;
  }

  // Cadangan untuk contenteditable lain: ketik baris demi baris.
  function insertByTyping(doc, text) {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    lines.forEach((line, i) => {
      if (i > 0) doc.execCommand("insertParagraph");
      if (line) doc.execCommand("insertText", false, line);
    });
  }

  function editableOf(node, doc) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    if (!el) return null;
    if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && TEXT_INPUT.test(el.type))) return el;
    if (el.isContentEditable || doc.designMode === "on") return el;
    return null;
  }

  function install(win) {
    const doc = win.document;
    if (!doc?.documentElement || win.__mentariPasteDE === doc.documentElement) return;
    win.__mentariPasteDE = doc.documentElement;

    // Shortcut copy/paste di kolom ketik tidak boleh dicegat halaman (Ctrl+Z dibiarkan untuk undo editor).
    win.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[acvx]$/i.test(e.key) && editableOf(e.target, doc)) {
        e.stopImmediatePropagation();
      }
    }, true);

    win.addEventListener("paste", (e) => {
      const el = editableOf(e.target, doc);
      if (!el) return;
      const text = e.clipboardData?.getData("text/plain") || "";
      if (!text) return; // paste gambar/file: serahkan ke editor
      // Jangan teruskan ke editor/halaman (di situlah pemblokir paste berada).
      e.stopImmediatePropagation();
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return; // paste bawaan browser berjalan
      e.preventDefault();
      if (!insertViaEditor(el, textToHtml(text), false)) insertByTyping(doc, text);
    }, true);

    for (const type of ["copy", "cut", "contextmenu", "selectstart"]) {
      win.addEventListener(type, (e) => {
        if (editableOf(e.target, doc)) e.stopImmediatePropagation();
      }, true);
    }
  }

  install(window);

  // Iframe editor (TinyMCE) — pasang ulang bila dokumennya dibangun ulang dengan document.open().
  function scanFrames() {
    for (const f of document.querySelectorAll("iframe")) {
      try { if (f.contentWindow) install(f.contentWindow); } catch { /* beda origin */ }
    }
  }
  const startWatch = () => {
    scanFrames();
    new MutationObserver(scanFrames).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scanFrames, 1000);
  };
  if (document.documentElement) startWatch();
  else document.addEventListener("DOMContentLoaded", startWatch, { once: true });

  // Permintaan dari content script extension: isi editor dengan jawaban AI lewat API editor.
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (ev.source !== window || !d || d.__mentariSetEditor !== true) return;
    const el = document.querySelector(`[data-mentari-target="${CSS.escape(String(d.id))}"]`);
    let ok = false;
    if (el) {
      ok = insertViaEditor(el, textToHtml(d.text || ""), true);
      el.removeAttribute("data-mentari-target");
    }
    window.postMessage({ __mentariSetEditorDone: true, id: d.id, ok }, "*");
  });
})();
