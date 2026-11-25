// Mentari UNPAM Assistant — content script
// Fitur: menu ⚡ kontekstual, auto kuis 1-klik sampai Finish, tombol Tanya AI di samping Reply forum,
// auto-isi kuesioner, ringkas materi, dan asisten forum diskusi.
(() => {
  if (window.__mentariAssistant) return;
  window.__mentariAssistant = true;

  const settings = {
    autoKuesioner: true,
    kuesionerMode: "ya",
    autoKuis: true,
    autoKuisFinish: true,
    autoKuisProvider: "groq"
  };
  chrome.storage.local.get(["autoKuesioner", "kuesionerMode", "autoKuis", "autoKuisFinish", "autoKuisProvider"], (s) => {
    if (typeof s.autoKuesioner === "boolean") settings.autoKuesioner = s.autoKuesioner;
    if (s.kuesionerMode) settings.kuesionerMode = s.kuesionerMode;
    if (typeof s.autoKuis === "boolean") settings.autoKuis = s.autoKuis;
    if (typeof s.autoKuisFinish === "boolean") settings.autoKuisFinish = s.autoKuisFinish;
    if (s.autoKuisProvider) settings.autoKuisProvider = s.autoKuisProvider;
  });
  chrome.storage.onChanged.addListener((c) => {
    if (c.autoKuesioner) settings.autoKuesioner = c.autoKuesioner.newValue;
    if (c.kuesionerMode) settings.kuesionerMode = c.kuesionerMode.newValue;
    if (c.autoKuis) settings.autoKuis = c.autoKuis.newValue;
    if (c.autoKuisFinish) settings.autoKuisFinish = c.autoKuisFinish.newValue;
    if (c.autoKuisProvider) settings.autoKuisProvider = c.autoKuisProvider.newValue;
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Dua penyedia AI dengan tombol terpisah.
  const PROVIDER_LABEL = { groq: "Groq", classai: "Haiku 5.5", deepseek: "DeepSeek" };
  const QUIZ_BTN_TEXT = { groq: "🤖 Auto Kuis · Groq", classai: "🤖 Auto Kuis · Haiku", deepseek: "🤖 Auto Kuis · DeepSeek" };

  // Tombol AI hanya ditampilkan untuk AI yang API key-nya sudah diisi di pengaturan.
  const KEY_NAMES = { groq: "groqApiKey", classai: "classaiApiKey", deepseek: "deepseekApiKey" };
  const hasKey = { groq: false, classai: false, deepseek: false };
  const anyKey = () => Object.values(hasKey).some(Boolean);
  function refreshKeyUi() { try { render(); syncInlineAi(); } catch { /* UI belum siap */ } }
  chrome.storage.local.get(Object.values(KEY_NAMES), (s) => {
    for (const p in KEY_NAMES) hasKey[p] = !!s[KEY_NAMES[p]];
    refreshKeyUi();
  });
  chrome.storage.onChanged.addListener((c) => {
    let changed = false;
    for (const p in KEY_NAMES) if (c[KEY_NAMES[p]]) { hasKey[p] = !!c[KEY_NAMES[p]].newValue; changed = true; }
    if (changed) refreshKeyUi();
  });
  function syncInlineAi() {
    document.querySelectorAll("[data-mentari-ai-reply][data-provider]").forEach((b) => {
      b.style.display = hasKey[b.dataset.provider] ? "inline-flex" : "none";
    });
  }
  // AI untuk Auto Kuis: pilihan di pengaturan, atau AI lain yang key-nya ada.
  function quizProvider() {
    if (hasKey[settings.autoKuisProvider]) return settings.autoKuisProvider;
    return Object.keys(hasKey).find((p) => hasKey[p]) || null;
  }
  const INLINE_AI = [
    { provider: "groq", kind: "answer", text: "⚡ AI Groq", color: "#7C3AED" },
    { provider: "classai", kind: "answer", text: "🧠 AI Haiku", color: "#C2410C" },
    { provider: "groq", kind: "question", text: "❓ Tanya Groq", color: "#0E7490" },
    { provider: "classai", kind: "question", text: "❓ Tanya Haiku", color: "#B45309" },
    { provider: "deepseek", kind: "answer", text: "🐋 AI DeepSeek", color: "#1D4ED8" },
    { provider: "deepseek", kind: "question", text: "❓ Tanya DeepSeek", color: "#0369A1" }
  ];

  // ---------------------------------------------------------------- deteksi
  function detect() {
    const url = location.href.toLowerCase();
    const text = (document.body?.innerText || "").toLowerCase();
    const hasRadios = !!document.querySelector('[role="radiogroup"], [role="radio"], .MuiFormGroup-root, .MuiRadio-root, input[type="radio"]');

    const quizEl = document.querySelector(
      '#posttest, #pretest, #quiz, #kuis, #soal, [id*="posttest"], [id*="post-test"], [id*="pretest"], [id*="pre-test"], [id*="quiz"], [id*="kuis"], [id*="exam"], [id*="question"]'
    );
    const hasReplyBtn = [...document.querySelectorAll('button, a[role="button"]')].some((b) =>
      !b.closest("#mentari-assistant-root") &&
      !b.hasAttribute("data-mentari-ai-reply") &&
      /^(reply|balas)$/i.test(cleanBtnText(b))
    );
    // Halaman forum diskusi: dicek dulu supaya teks menu "Post Test" di sidebar tidak bikin salah deteksi kuis.
    const isForum = /forum|diskusi/.test(url) ||
      hasReplyBtn ||
      (/forum diskusi/.test(text) && !!document.querySelector("textarea, [contenteditable='true'], .ql-editor"));
    const isQuiz = !isForum && (
      !!quizEl ||
      /posttest|post-test|pretest|pre-test|quiz|kuis|exam|uts|uas|attempt/.test(url) ||
      /post[ -]test|pre[ -]test|multiple choice|navigasi soal/.test(text) ||
      (hasRadios && /pilihan ganda|sisa waktu|waktu tersisa|soal\s+\d|pertanyaan\s+\d/.test(text)));

    const kuesionerEl = document.querySelector(
      '#kuesioner, #kuisioner, #survey, #angket, [id*="kuesioner"], [id*="kuisioner"], [id*="survey"], [id*="angket"]'
    );
    // "Kuat" = boleh diisi otomatis. "Lemah" = hanya tampilkan tombol manual.
    const kuesionerStrong =
      !isQuiz && hasRadios && (!!kuesionerEl || /kuesioner|kuisioner|angket|survey/.test(url));
    const kuesionerWeak =
      !isQuiz && hasRadios &&
      /kuesioner|kuisioner|angket evaluasi|evaluasi dosen|sangat setuju|sangat baik/.test(text);

    return { isQuiz, isForum, hasRadios, kuesionerStrong, isKuesioner: kuesionerStrong || kuesionerWeak };
  }

  // ------------------------------------------------------- util DOM
  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isButtonEnabled(b) {
    if (!b || !isVisible(b) || b.closest("#mentari-assistant-root")) return false;
    if (b.disabled) return false;
    if (b.getAttribute("aria-disabled") === "true") return false;
    if (b.classList.contains("Mui-disabled")) return false;
    return true;
  }

  function cleanBtnText(b) {
    return (b?.innerText || b?.value || b?.getAttribute?.("aria-label") || "")
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function labelTextRaw(radio) {
    const lbl = radio.closest("label, .MuiFormControlLabel-root") ||
      (radio.id && document.querySelector(`label[for="${CSS.escape(radio.id)}"]`)) ||
      radio.parentElement;
    return ((lbl && lbl.innerText) || radio.value || "").replace(/\s+/g, " ").trim();
  }

  function labelText(radio) {
    return labelTextRaw(radio).toLowerCase();
  }

  function clickRadio(target) {
    const clickable = target.closest("label, .MuiFormControlLabel-root, .MuiRadio-root, .MuiButtonBase-root") || target;
    clickable.click();
    if ("checked" in target && !target.checked) {
      target.click();
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function setEditorValue(editor, value) {
    if (!editor) return false;
    if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
      const proto = editor.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(editor, value);
      else editor.value = value;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      editor.focus();
      return true;
    }
    if (editor.isContentEditable || editor.classList.contains("ql-editor")) {
      editor.focus();
      editor.innerText = value;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      // Editor Advance (CKEditor/TinyMCE): isi juga lewat API editornya (pastemain.js) supaya
      // jawaban benar-benar tersimpan dan tidak hilang saat tombol kirim diklik.
      const id = "m" + Date.now() + Math.random().toString(36).slice(2, 6);
      editor.setAttribute("data-mentari-target", id);
      window.postMessage({ __mentariSetEditor: true, id, text: value }, "*");
      return true;
    }
    return false;
  }

  // ------------------------------------------------------- isi kuesioner
  const YES_RE = /^(ya|yes)$|sangat baik|sangat setuju|sangat puas/;
  const NO_RE = /^(tidak|no)$|tidak setuju|kurang/;

  // Status centang: utamakan tampilan MUI (Mui-checked), karena radio yang memakai "name" sama
  // di semua soal bisa saling melepas status checked bawaan HTML.
  function isRadioChecked(r) {
    const mui = r.closest(".MuiRadio-root");
    if (mui) return mui.classList.contains("Mui-checked");
    return r.checked || r.getAttribute("aria-checked") === "true";
  }

  // Kelompokkan radio per soal berdasarkan posisinya di halaman (bukan atribut name):
  // satu soal = elemen terkecil yang membungkus lebih dari satu radio.
  function kuesionerGroups() {
    const radios = [...document.querySelectorAll('input[type="radio"]')]
      .filter((r) => !r.closest("#mentari-assistant-root"));
    const groups = new Map();
    radios.forEach((r) => {
      let key = r.closest('[role="radiogroup"]');
      if (!key) {
        let cur = r.parentElement;
        while (cur && cur !== document.body && cur.querySelectorAll('input[type="radio"]').length < 2) {
          cur = cur.parentElement;
        }
        key = cur || r;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    return [...groups.values()];
  }

  function fillKuesioner(mode) {
    if (detect().isQuiz) return 0; // pengaman ganda
    const want = mode === "tidak" ? NO_RE : YES_RE;
    let filled = 0;
    kuesionerGroups().forEach((radios) => {
      if (radios.some(isRadioChecked) || radios.every((r) => r.disabled)) return;
      const target =
        radios.find((r) => want.test(labelText(r))) ||
        (mode === "tidak" ? radios[radios.length - 1] : radios[0]);
      clickRadio(target);
      filled++;
    });
    return filled;
  }

  // ------------------------------------------------------- auto kuis AI (1-klik semua soal + Finish)
  function findOptionRow(control, selector) {
    let row = control.closest("label, .MuiFormControlLabel-root") || control;
    let cur = row;
    for (let depth = 0; depth < 6 && cur.parentElement && cur.parentElement !== document.body; depth++) {
      const parent = cur.parentElement;
      const countInParent = parent.querySelectorAll(selector).length;
      if (countInParent > 1) return cur;
      cur = parent;
    }
    return row;
  }

  function optionRowText(opt) {
    const raw = (opt.row?.innerText || "").replace(/\s+/g, " ").trim();
    if (raw) return raw;
    if (opt.control) {
      const lbl = labelTextRaw(opt.control);
      if (lbl) return lbl;
    }
    return "(kosong)";
  }

  function isOptionChecked(opt) {
    const c = opt.control;
    if (!c) return false;
    if ("checked" in c && typeof c.checked === "boolean") return c.checked;
    if (c.getAttribute("aria-checked") === "true") return true;
    if (opt.row?.getAttribute("aria-checked") === "true") return true;
    const mui = c.closest(".MuiRadio-root, .MuiButtonBase-root");
    return !!(mui && mui.classList.contains("Mui-checked"));
  }

  function clickOption(opt) {
    const c = opt.control;
    const primary = (c && c.closest("label, .MuiFormControlLabel-root, .MuiRadio-root, .MuiButtonBase-root")) || c || opt.row;
    if (primary) primary.click();

    if (c && !isOptionChecked(opt)) {
      c.click();
      c.dispatchEvent(new Event("input", { bubbles: true }));
      c.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (opt.row && opt.row !== primary && !isOptionChecked(opt)) {
      opt.row.click();
    }
  }

  function collectQuizGroupsBySelector(selector) {
    const controls = [...document.querySelectorAll(selector)].filter((el) => {
      if (el.closest("#mentari-assistant-root")) return false;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
      const visTarget = el.closest("label, .MuiFormControlLabel-root, .MuiRadio-root, .MuiButtonBase-root") || el.parentElement || el;
      return isVisible(visTarget);
    });
    if (controls.length < 2) return [];

    const items = controls.map((control) => {
      const row = findOptionRow(control, selector);
      const groupEl = control.closest('[role="radiogroup"], .MuiFormGroup-root');
      const name = control.getAttribute("name") || "";
      return { control, row, groupEl, name };
    });

    const groups = new Map();
    items.forEach((item) => {
      const key = item.groupEl || (item.name ? `name:${item.name}` : null) || item.row.parentElement || "page_single_quiz";
      if (!groups.has(key)) {
        groups.set(key, {
          container: item.groupEl || item.row.parentElement,
          options: []
        });
      }
      groups.get(key).options.push(item);
    });

    const valid = [...groups.values()].filter((g) => g.options.length >= 2);
    if (valid.length) return valid;

    if (items.length >= 2 && items.length <= 8) {
      let common = items[0].row.parentElement;
      while (common && common !== document.body && !items.every((it) => common.contains(it.row))) {
        common = common.parentElement;
      }
      return [{ container: common || document.body, options: items }];
    }
    return [];
  }

  function collectLetterOptionGroups() {
    const letterRe = /^[A-E][.)]\s+\S/;
    const candidates = [...document.querySelectorAll("button, li, label, div")].filter((el) => {
      if (el.closest("#mentari-assistant-root, nav, aside, header")) return false;
      if (!isVisible(el)) return false;
      const txt = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (txt.length < 3 || txt.length > 500 || !letterRe.test(txt)) return false;
      const hasMatchingChild = [...el.children].some((ch) =>
        letterRe.test((ch.innerText || "").replace(/\s+/g, " ").trim())
      );
      return !hasMatchingChild;
    });

    const byParent = new Map();
    candidates.forEach((el) => {
      const parent = el.parentElement;
      if (!parent) return;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push({ control: el, row: el, groupEl: parent, name: "" });
    });

    const result = [];
    byParent.forEach((opts, parent) => {
      const letters = new Set(opts.map((o) => (o.row.innerText || "").trim()[0]));
      if (opts.length >= 2 && letters.size >= 2) {
        result.push({ container: parent, options: opts });
      }
    });
    return result;
  }

  function getQuizGroups() {
    let groups = collectQuizGroupsBySelector('input[type="radio"]');
    if (!groups.length) groups = collectQuizGroupsBySelector('[role="radio"]');
    if (!groups.length) groups = collectLetterOptionGroups();
    return groups;
  }

  function extractQuestionText(group, totalGroups) {
    const optionTexts = group.options.map((o) => optionRowText(o)).filter((t) => t && t !== "(kosong)");
    const anchor = group.container || group.options[0].row;

    let node = anchor;
    let bestContainer = null;
    for (let depth = 0; depth < 7 && node && node !== document.body; depth++) {
      if (totalGroups > 1) {
        const radiosInNode = node.querySelectorAll('input[type="radio"], [role="radio"]').length;
        if (radiosInNode > group.options.length) break;
      }
      bestContainer = node;
      const raw = (node.innerText || "").replace(/\s+/g, " ").trim();
      const withoutOpts = optionTexts.reduce((acc, o) => acc.replace(o, ""), raw).trim();
      if (withoutOpts.length >= 25) break;
      node = node.parentElement;
    }

    if (bestContainer) {
      const marks = [];
      group.options.forEach((o) => {
        if (o.row && bestContainer.contains(o.row)) {
          o.row.setAttribute("data-mentari-opt-tmp", "1");
          marks.push(o.row);
        }
      });
      const clone = bestContainer.cloneNode(true);
      marks.forEach((el) => el.removeAttribute("data-mentari-opt-tmp"));

      clone.querySelectorAll('[data-mentari-opt-tmp="1"], [role="radiogroup"], .MuiFormGroup-root, input, button, nav, aside').forEach((el) => el.remove());
      const cleaned = (clone.innerText || "")
        .replace(/\b(multiple choice|sudah dijawab|belum dijawab)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned.length >= 8) return cleaned.slice(0, 1800);
    }

    const collected = [];
    let prev = anchor.previousElementSibling;
    for (let step = 0; step < 6 && prev; step++) {
      if (prev.querySelector('input[type="radio"], [role="radio"]')) break;
      const t = (prev.innerText || "").replace(/\s+/g, " ").trim();
      if (t) collected.unshift(t);
      if (collected.join(" ").length >= 25) break;
      prev = prev.previousElementSibling;
    }
    const siblingText = collected.join(" ").trim();
    if (siblingText.length >= 8) return siblingText.slice(0, 1800);

    const main = document.querySelector("main, [role='main'], .MuiContainer-root") || document.body;
    let fallback = (main.innerText || "").replace(/\s+/g, " ").trim();
    optionTexts.forEach((o) => { fallback = fallback.replace(o, ""); });
    return fallback.replace(/\s+/g, " ").trim().slice(0, 1200);
  }

  function getQuizScreenSignature() {
    const groups = getQuizGroups();
    if (groups.length) {
      return groups.map((g) => {
        const q = extractQuestionText(g, groups.length).slice(0, 120);
        const o = g.options.map((x) => optionRowText(x).slice(0, 40)).join("|");
        return q + "::" + o;
      }).join("##");
    }
    const main = document.querySelector("main, [role='main'], .MuiContainer-root") || document.body;
    return (main.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220);
  }

  function findNextButton() {
    const nextRe = /^(next|selanjutnya|berikutnya|soal berikutnya|lanjut)$/i;
    const buttons = [...document.querySelectorAll('button, a[role="button"], input[type="button"], input[type="submit"]')];
    return buttons.find((b) => isButtonEnabled(b) && nextRe.test(cleanBtnText(b))) || null;
  }

  // Tombol di area konten halaman (bukan sidebar/header/extension).
  function contentButtons() {
    return [...document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"], input[type="submit"]')]
      .filter((b) => isButtonEnabled(b) && !b.closest("nav, aside, header, .MuiDrawer-root, .MuiAppBar-root"));
  }

  function findFinishButton() {
    const exactRe = /^(finish|selesai|selesaikan|submit|kirim|akhiri|kumpulkan|finish attempt|finish quiz|selesai kuis|kirim jawaban|submit quiz|selesai ujian|selesaikan kuis|akhiri kuis|akhiri ujian|kumpulkan jawaban|submit jawaban|selesai dan kirim|simpan dan selesai)$/i;
    const looseRe = /\b(selesai|selesaikan|finish|submit|kirim|akhiri|kumpulkan)\b/i;
    const avoidRe = /sebelum|previous|prev|next|berikut|lanjut|batal|cancel|kembali|back|komentar|reply|balas/i;
    const buttons = contentButtons();
    return buttons.find((b) => exactRe.test(cleanBtnText(b))) ||
      buttons.find((b) => {
        const t = cleanBtnText(b);
        return t.length <= 40 && looseRe.test(t) && !avoidRe.test(t);
      }) || null;
  }

  // Tombol untuk MEMULAI kuis (halaman awal sebelum soal muncul).
  function findStartButton() {
    const exactRe = /^(mulai|mulai kuis|mulai quiz|mulai ujian|mulai test|mulai tes|mulai post test|mulai pre test|mulai posttest|mulai pretest|mulai mengerjakan|kerjakan|kerjakan kuis|kerjakan sekarang|start|start quiz|attempt quiz|attempt quiz now|ikuti kuis|coba kuis|lanjutkan kuis|lanjut mengerjakan|lanjutkan mengerjakan)$/i;
    const looseRe = /\b(mulai|kerjakan|start|attempt)\b.*\b(kuis|quiz|ujian|test|tes|posttest|pretest)\b/i;
    // Tombol mengulang kuis tidak pernah diklik otomatis.
    const retakeRe = /ulang|ulangi|lagi|again|retake|re attempt|reattempt|remedial/i;
    const buttons = contentButtons().filter((b) => !retakeRe.test(cleanBtnText(b)));
    return buttons.find((b) => exactRe.test(cleanBtnText(b))) ||
      buttons.find((b) => { const t = cleanBtnText(b); return t.length <= 40 && looseRe.test(t); }) || null;
  }

  function isQuizStartPage() {
    const url = location.href.toLowerCase();
    const text = (document.querySelector("main, [role='main']")?.innerText || document.body.innerText || "").toLowerCase();
    return /quiz|kuis|posttest|post-test|pretest|pre-test/.test(url) ||
      /\b(kuis|quiz|post test|posttest|pre test|pretest)\b/.test(text.slice(0, 5000));
  }

  // ---- Ingatan kuis yang sudah selesai (permanen, tidak hilang saat halaman dimuat ulang)
  const DONE_KEY = "kuisSelesai";
  const normUrl = (u = location.href) => { try { const x = new URL(u); return x.origin + x.pathname.replace(/\/+$/, ""); } catch { return u; } };
  let doneQuiz = {};
  chrome.storage.local.get(DONE_KEY, (s) => { doneQuiz = s[DONE_KEY] || {}; });
  chrome.storage.onChanged.addListener((c) => { if (c[DONE_KEY]) doneQuiz = c[DONE_KEY].newValue || {}; });
  const isQuizDone = (u = location.href) => !!doneQuiz[normUrl(u)];
  async function markQuizDone(...urls) {
    const { [DONE_KEY]: cur = {}, kuisStartUrl } = await chrome.storage.local.get([DONE_KEY, "kuisStartUrl"]);
    const now = Date.now();
    [...urls, kuisStartUrl].filter(Boolean).forEach((u) => { cur[normUrl(u)] = now; });
    const keep = Object.entries(cur).sort((a, b) => b[1] - a[1]).slice(0, 500);
    doneQuiz = Object.fromEntries(keep);
    await chrome.storage.local.set({ [DONE_KEY]: doneQuiz });
  }
  // Halaman kuis yang menampilkan tanda sudah dikerjakan / sudah ada nilai.
  function pageShowsQuizDone() {
    const text = (document.querySelector("main, [role='main']")?.innerText || document.body.innerText || "").toLowerCase();
    return /sudah (di)?kerjakan|telah (di)?kerjakan|sudah mengerjakan|telah mengerjakan|selesai dikerjakan|sudah selesai|telah selesai|kuis selesai|quiz sudah selesai|sudah dijawab|sudah dikumpulkan|telah dikumpulkan|submitted|completed|nilai anda|skor anda|nilai kamu|skor kamu|hasil kuis|hasil quiz|riwayat pengerjaan|kesempatan habis|batas percobaan/.test(text);
  }

  let autoStartedOnUrl = "";
  let autoStartBusy = false;
  async function autoStartQuiz() {
    if (autoStartBusy || autoStartedOnUrl === location.href) return;
    if (!isQuizStartPage()) return;
    if (isQuizDone() || pageShowsQuizDone()) { autoStartedOnUrl = location.href; return; }
    const startBtn = findStartButton();
    if (!startBtn) return;
    autoStartBusy = true;
    autoStartedOnUrl = location.href;
    try {
      toast("▶️ Memulai kuis otomatis...");
      await chrome.storage.local.set({ kuisStartUrl: normUrl() });
      startBtn.click();
      for (let i = 0; i < 15; i++) {
        await sleep(200);
        const confirmBtn = findConfirmDialogButton();
        if (confirmBtn) { confirmBtn.click(); break; }
        if (detect().isQuiz) break;
      }
    } finally {
      autoStartBusy = false;
    }
  }

  function findConfirmDialogButton() {
    const dialogs = [
      ...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .MuiDialog-root, .MuiModal-root, .swal2-popup, .modal')
    ].filter(isVisible);
    const confirmRe = /^(ya|yes|ok|oke|finish|selesai|selesaikan|submit|kirim|konfirmasi|yakin|akhiri|kumpulkan|ya selesai|ya kirim|ya kumpulkan|ya akhiri|lanjutkan|mulai|ya mulai|mulai sekarang|kerjakan|start)$/i;
    const cancelRe = /^(tidak|no|batal|cancel|kembali|tutup|close)$/i;

    for (const dlg of dialogs) {
      const btns = [...dlg.querySelectorAll('button, a[role="button"], input[type="button"], input[type="submit"]')].filter(isButtonEnabled);
      const exact = btns.find((b) => {
        const t = cleanBtnText(b);
        return confirmRe.test(t) && !cancelRe.test(t);
      });
      if (exact) return exact;

      const primary = dlg.querySelector(".swal2-confirm, .MuiButton-containedPrimary, .MuiButton-containedSuccess, .MuiButton-containedError");
      if (primary && isButtonEnabled(primary) && !cancelRe.test(cleanBtnText(primary))) {
        return primary;
      }
    }
    return null;
  }

  async function waitForScreenChange(prevSig, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (quizAbort) return false;
      await sleep(80);
      if (getQuizScreenSignature() !== prevSig) return true;
      if (findFinishButton() && !findNextButton()) return true;
    }
    return false;
  }

  let quizBusy = false;
  let quizAbort = false;
  let autoQuizRanOnUrl = "";
  let quizBtn = null; // tombol Auto Kuis (Groq/Haiku) yang sedang berjalan

  async function runAutoQuizAll(isAutoTrigger = false, provider = "groq") {
    if (quizBusy) {
      if (!isAutoTrigger) {
        quizAbort = true;
        quizBtn.textContent = "⏹️ Menghentikan...";
        toast("⏹️ Auto Kuis dihentikan");
      }
      return;
    }

    const initialGroups = getQuizGroups();
    if (!initialGroups.length && !findNextButton() && !findFinishButton()) {
      if (!isAutoTrigger) toast("🤖 Tidak ditemukan soal pilihan ganda di halaman ini");
      return;
    }

    if (isAutoTrigger && (autoQuizRanOnUrl === location.href || isQuizDone())) return;
    autoQuizRanOnUrl = location.href;

    quizBusy = true;
    quizAbort = false;
    quizBtn = quizBtns[provider] || btnQuizGroq;
    const otherQuizBtns = Object.values(quizBtns).filter((b) => b !== quizBtn);
    otherQuizBtns.forEach((b) => (b.disabled = true));
    let totalAnswered = 0;
    let step = 0;
    const MAX_STEPS = 120;
    const seenScreens = new Set();

    try {
      toast(`🤖 Auto Kuis (${PROVIDER_LABEL[provider]}) berjalan — menjawab semua soal...`);

      while (!quizAbort && step < MAX_STEPS) {
        step++;
        const allGroups = getQuizGroups();
        const unanswered = allGroups.filter((g) => !g.options.some((o) => isOptionChecked(o)));

        if (unanswered.length) {
          quizBtn.textContent = `⏹️ Stop (Soal #${step}...)`;
          const payload = unanswered.map((g, idx) => ({
            id: idx,
            question: extractQuestionText(g, allGroups.length),
            options: g.options.map((o) => optionRowText(o))
          }));

          const res = await chrome.runtime.sendMessage({ type: "solveQuiz", questions: payload, provider });
          if (!res?.ok) {
            toast("❌ " + (res?.error || "Gagal menjawab kuis"));
            return;
          }

          let pageAnswered = 0;
          (res.answers || []).forEach((item) => {
            const g = unanswered[item.id];
            const ansIdx = Number(item.answer);
            if (!g || Number.isNaN(ansIdx) || ansIdx < 0 || ansIdx >= g.options.length) return;
            clickOption(g.options[ansIdx]);
            pageAnswered++;
            totalAnswered++;
          });

          if (pageAnswered > 0) {
            await sleep(300); // beri waktu React/API menyimpan jawaban
          }
        }

        if (quizAbort) break;

        const nextBtn = findNextButton();
        if (nextBtn) {
          const prevSig = getQuizScreenSignature();
          if (seenScreens.has(prevSig + "|" + step)) break;
          seenScreens.add(prevSig + "|" + step);
          quizBtn.textContent = `⏹️ Stop (Lanjut #${step + 1}...)`;
          nextBtn.click();
          const changed = await waitForScreenChange(prevSig, 5000);
          if (!changed) break;
          await sleep(120);
          continue;
        }

        // Tidak ada tombol NEXT aktif -> sudah di soal terakhir (atau semua soal 1 halaman)
        break;
      }

      if (quizAbort) return;

      // Klik Finish otomatis jika diaktifkan (default: aktif)
      if (settings.autoKuisFinish) {
        // Tombol Selesai kadang baru muncul/aktif sesaat setelah jawaban terakhir tersimpan.
        let finishBtn = null;
        for (let i = 0; i < 15 && !finishBtn && !quizAbort; i++) {
          await sleep(200);
          finishBtn = findFinishButton();
        }
        if (!finishBtn) {
          const seen = contentButtons().map((b) => cleanBtnText(b)).filter(Boolean).slice(0, 8);
          console.log("[Mentari Assistant] Tombol yang terlihat:", seen);
          toast(`⚠️ Tombol Selesai tidak ditemukan. Tombol terlihat: ${seen.join(", ") || "-"}`);
        }
        if (finishBtn) {
          quizBtn.textContent = "🏁 Mengirim...";
          finishBtn.click();
          // Tunggu dialog konfirmasi jika ada (MUI Dialog / SweetAlert)
          for (let attempt = 0; attempt < 20; attempt++) {
            await sleep(200);
            const confirmBtn = findConfirmDialogButton();
            if (confirmBtn) {
              confirmBtn.click();
              await sleep(400);
              break;
            }
          }
          await markQuizDone(location.href);
          toast(`✅ Selesai! ${totalAnswered} soal dijawab & Finish diklik`);
          return;
        }
      }

      if (isAutoTrigger) await markQuizDone(location.href);
      toast(`✅ Auto Kuis selesai: ${totalAnswered} soal terjawab`);
    } catch (err) {
      toast("❌ Extension dimuat ulang — refresh halaman ini");
    } finally {
      quizBusy = false;
      quizAbort = false;
      quizBtn.textContent = QUIZ_BTN_TEXT[provider] || QUIZ_BTN_TEXT.groq;
      otherQuizBtns.forEach((b) => (b.disabled = false));
    }
  }

  // ------------------------------------------------------- tombol Tanya AI di samping REPLY forum
  const isReplyBtn = (b) =>
    !b.closest("#mentari-assistant-root") &&
    !b.hasAttribute("data-mentari-ai-reply") &&
    /^(reply|balas)$/i.test(cleanBtnText(b));
  const NOISE_SEL = 'button, [data-mentari-ai-reply], textarea, input, select, nav, aside, svg, img, script, style';

  // Cari elemen pembungkus satu postingan (kartu) untuk sebuah tombol Reply.
  function forumPostContainer(replyBtn) {
    let node = replyBtn.parentElement;
    let best = null;
    for (let depth = 0; depth < 8 && node && node !== document.body; depth++) {
      const replyBtns = [...node.querySelectorAll('button, a[role="button"]')].filter(isReplyBtn);
      if (replyBtns.length > 1) break;

      const rawAll = (node.innerText || "").trim();
      if (best && /\bmahasiswa\b/i.test(rawAll) && !/\bmahasiswa\b/i.test(best.innerText || "")) break;

      const clone = node.cloneNode(true);
      clone.querySelectorAll(NOISE_SEL).forEach((el) => el.remove());
      const cleaned = (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
      if (cleaned.length >= 20) {
        best = node;
        const style = getComputedStyle(node);
        const hasBorder = parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderBottomWidth) > 0;
        const hasRadius = parseFloat(style.borderRadius) >= 4;
        if (cleaned.length >= 60 && (hasBorder || hasRadius)) break;
      }
      node = node.parentElement;
    }
    return best;
  }

  // Buang baris "sampah" (tanggal, jam, jumlah like/komentar, label tombol) supaya AI fokus ke isi soal.
  function cleanForumText(raw) {
    const noise = [
      /^(reply|balas|like|suka|edit|hapus|delete|lihat balasan|tampilkan|show more|lihat selengkapnya)$/i,
      /^\d+$/,
      /^\d+\s*(balasan|komentar|replies|reply|likes?|suka)$/i,
      /^\d{1,2}:\d{2}(:\d{2})?(\s*(wib|am|pm))?$/i,
      /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/,
      /^(\w+,\s*)?\d{1,2}\s+[a-z]{3,9}\.?\s+\d{4}(\s*[,|]?\s*\d{1,2}[:.]\d{2}(\s*wib)?)?$/i,
      /^\d+\s+(detik|menit|jam|hari|minggu|bulan|tahun)\s+(yang\s+)?lalu$/i
    ];
    return String(raw || "")
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l) => l && !noise.some((re) => re.test(l)))
      .join("\n")
      .trim();
  }

  function elementText(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(NOISE_SEL).forEach((n) => n.remove());
    return cleanForumText(blockText(clone));
  }

  // Node hasil clone tidak ter-render sehingga innerText kehilangan baris baru:
  // sisipkan "\n" setelah tiap elemen blok agar teks tetap terpisah per baris.
  function blockText(node) {
    node.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    node.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, header, blockquote, pre, ol, ul")
      .forEach((b) => b.append("\n"));
    node.querySelectorAll("li").forEach((li) => {
      const ol = li.parentElement?.tagName === "OL" ? li.parentElement : null;
      const idx = ol ? [...ol.children].filter((c) => c.tagName === "LI").indexOf(li) + 1 : 0;
      li.prepend(idx ? `${idx}. ` : "- ");
    });
    return node.textContent || "";
  }

  // Teks di area konten sebelum postingan pertama (judul forum, deskripsi, soal dari dosen).
  function forumHeaderText(firstPost, root) {
    if (!firstPost || !root.contains(firstPost)) return "";
    try {
      const range = document.createRange();
      range.setStart(root, 0);
      range.setEndBefore(firstPost);
      const frag = range.cloneContents();
      frag.querySelectorAll(NOISE_SEL).forEach((n) => n.remove());
      const box = document.createElement("div");
      box.appendChild(frag);
      const text = cleanForumText(blockText(box));
      return text.slice(-2500);
    } catch {
      return "";
    }
  }

  function extractForumPostQuestion(replyBtn) {
    const root = document.querySelector("main, [role='main'], .MuiContainer-root") || document.body;
    const allReply = [...document.querySelectorAll('button, a[role="button"]')]
      .filter((b) => isReplyBtn(b) && isVisible(b));

    const clickedPost = forumPostContainer(replyBtn);
    const firstPost = allReply.length ? forumPostContainer(allReply[0]) : null;
    let topicPost = firstPost || clickedPost;

    const header = forumHeaderText(topicPost, root);
    // Jika soal dosen sudah ada di bagian atas (tanpa tombol Reply), postingan pertama yang punya
    // tombol Reply adalah postingan teman, bukan postingan dosen.
    const headerHasQuestion = header.length >= 120 &&
      /\?|jelaskan|sebutkan|bagaimana|mengapa|kenapa|apa(kah)? |diskusikan|analisis|berikan|uraikan|bandingkan/i.test(header);
    const firstLooksDosen = /\bdosen\b|lecturer|pengajar|\bS\.Kom\b|\bM\.(Kom|T|Si|M|Pd|Ak)\b|\bDr\.|\bIr\./.test(elementText(firstPost));
    if (headerHasQuestion && !firstLooksDosen) topicPost = null;
    const topicText = elementText(topicPost);
    const parts = [];
    const soal = [header, topicText].filter(Boolean).join("\n").trim();
    const isFriendPost = !!clickedPost && clickedPost !== topicPost &&
      !(topicPost && (topicPost.contains(clickedPost) || clickedPost.contains(topicPost)));

    if (isFriendPost) {
      // Membalas postingan teman: postingan teman = yang harus dijawab, soal dosen hanya konteks.
      const friendText = elementText(clickedPost);
      if (friendText) {
        parts.push("POSTINGAN TEMAN YANG SAYA BALAS (INI YANG HARUS DIJAWAB/DITANGGAPI):\n" + friendText.slice(0, 4000));
      }
      if (soal) parts.push("KONTEKS: SOAL / TOPIK DISKUSI DARI DOSEN (jangan dijawab ulang):\n" + soal.slice(0, 3000));
    } else if (soal) {
      parts.push("SOAL / TOPIK DISKUSI DARI DOSEN:\n" + soal.slice(0, 6000));
    }

    if (!parts.length) {
      return cleanForumText((root.innerText || "")).slice(0, 6000);
    }
    return parts.join("\n\n");
  }

  function visibleEditors() {
    return [...document.querySelectorAll('textarea, .ql-editor, [contenteditable="true"]')].filter((el) =>
      !el.closest("#mentari-assistant-root") && isVisible(el) && !el.disabled && !el.readOnly &&
      !(el.matches('[contenteditable="true"]') && el.parentElement?.closest('[contenteditable="true"], .ql-editor'))
    );
  }

  // Cari kolom reply MILIK postingan yang tombolnya diklik (bukan kolom pertama di halaman).
  // before = editor yang sudah terlihat sebelum tombol Reply diklik (untuk mendeteksi editor baru).
  function findReplyEditorFor(replyBtn, before = null) {
    const editors = visibleEditors();
    if (!editors.length) return null;
    const post = forumPostContainer(replyBtn);

    // a. editor di dalam kartu postingan itu sendiri
    const inside = editors.find((el) => post && post.contains(el));
    if (inside) return inside;

    // b. editor yang berada setelah tombol Reply ini dan sebelum tombol Reply postingan berikutnya
    const allReply = [...document.querySelectorAll('button, a[role="button"]')].filter((b) => isReplyBtn(b) && isVisible(b));
    const nextReply = allReply.find((b) => replyBtn.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const between = editors.find((el) =>
      (replyBtn.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      (!nextReply || (el.compareDocumentPosition(nextReply) & Node.DOCUMENT_POSITION_FOLLOWING))
    );
    if (between) return between;

    if (before) {
      // c. editor yang baru muncul setelah Reply diklik (mis. dialog / kotak balasan baru)
      const fresh = editors.filter((el) => !before.has(el));
      if (fresh.length) {
        const y = replyBtn.getBoundingClientRect().top;
        return fresh.sort((a, b) =>
          Math.abs(a.getBoundingClientRect().top - y) - Math.abs(b.getBoundingClientRect().top - y))[0];
      }
      // d. tombol Reply memfokuskan kotak balasan bersama
      const active = document.activeElement;
      const focused = editors.find((el) => el === active || el.contains(active));
      if (focused) return focused;
      // e. hanya ada satu kotak balasan di halaman
      if (editors.length === 1) return editors[0];
    }
    return null;
  }

  async function handleInlineForumAi(replyBtn, aiBtn, provider, kind = "answer") {
    if (aiBtn.disabled) return;
    const question = extractForumPostQuestion(replyBtn);
    if (question.length < 10) {
      toast("❌ Teks pertanyaan forum tidak terdeteksi");
      return;
    }

    // Sinkronkan ke panel forum juga sebagai cadangan
    fq.value = question;
    saveDraft();

    aiBtn.disabled = true;
    const origText = aiBtn.textContent;
    aiBtn.textContent = `⏳ ${PROVIDER_LABEL[provider]}...`;
    aiBtn.style.opacity = "0.7";
    aiBtn.style.cursor = "wait";

    try {
      const res = await chrome.runtime.sendMessage({
        type: kind === "question" ? "forumQuestion" : "forumAnswer",
        question,
        provider,
        notes: fn.value.trim(),
        length: flen.value || "sedang"
      });
      if (!res?.ok) {
        toast("❌ " + (res?.error || "Gagal membuat jawaban AI"));
        return;
      }

      const answer = res.text;
      fa.value = answer;
      saveDraft();

      // Buka kolom reply jika belum terbuka
      let editor = findReplyEditorFor(replyBtn);
      if (!editor) {
        const before = new Set(visibleEditors());
        replyBtn.click();
        for (let i = 0; i < 16; i++) {
          await sleep(150);
          editor = findReplyEditorFor(replyBtn, before);
          if (editor) break;
        }
      }

      const filled = setEditorValue(editor, answer);

      try {
        await navigator.clipboard.writeText(answer);
      } catch {}

      if (filled) {
        editor.scrollIntoView({ behavior: "smooth", block: "center" });
        toast(`✅ ${kind === "question" ? "Pertanyaan" : /POSTINGAN TEMAN/.test(question) ? "Balasan untuk teman" : "Jawaban soal dosen"} (${PROVIDER_LABEL[provider]}) langsung masuk ke kolom reply (siap kirim/salin)`);
      } else {
        fpanel.classList.remove("hidden");
        toast("📋 Jawaban AI siap & disalin — paste ke kolom reply");
      }
    } catch (err) {
      toast("❌ Extension dimuat ulang — refresh halaman ini");
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = origText;
      aiBtn.style.opacity = "1";
      aiBtn.style.cursor = "pointer";
    }
  }

  function injectForumReplyAiButtons() {
    if (ctx.isQuiz) return;
    const buttons = [...document.querySelectorAll('button, a[role="button"]')];
    buttons.forEach((replyBtn) => {
      if (replyBtn.closest("#mentari-assistant-root")) return;
      if (replyBtn.hasAttribute("data-mentari-ai-reply")) return;
      if (!isVisible(replyBtn)) return;
      if (!/^(reply|balas)$/i.test(cleanBtnText(replyBtn))) return;

      const parent = replyBtn.parentElement;
      if (!parent) return;
      if (parent.querySelector('[data-mentari-ai-reply="1"]')) return;

      INLINE_AI.forEach(({ provider, kind, text, color }) => {
        const aiBtn = document.createElement("button");
        aiBtn.type = "button";
        aiBtn.setAttribute("data-mentari-ai-reply", "1");
        aiBtn.setAttribute("data-provider", provider);
        aiBtn.textContent = text;
        aiBtn.title = kind === "question"
          ? `Buat pertanyaan diskusi pakai ${PROVIDER_LABEL[provider]} dan isi ke kolom reply`
          : `Buat jawaban pakai ${PROVIDER_LABEL[provider]} dan langsung isi ke kolom reply`;
        Object.assign(aiBtn.style, {
          background: color,
          color: "#FFFFFF",
          border: "none",
          borderRadius: "6px",
          padding: "6px 12px",
          marginRight: "8px",
          fontSize: "13px",
          fontWeight: "600",
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          lineHeight: "1.4",
          verticalAlign: "middle",
          boxShadow: "none"
        });
        if (!hasKey[provider]) aiBtn.style.display = "none";
        aiBtn.addEventListener("mouseenter", () => { if (!aiBtn.disabled) aiBtn.style.filter = "brightness(1.08)"; });
        aiBtn.addEventListener("mouseleave", () => { aiBtn.style.filter = ""; });
        aiBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          handleInlineForumAi(replyBtn, aiBtn, provider, kind);
        });
        parent.insertBefore(aiBtn, replyBtn);
      });
    });
  }

  // ------------------------------------------------------------- ringkas
  function pageText() {
    const root = document.querySelector("main, [role='main'], .MuiContainer-root") || document.body;
    return (root.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 12000);
  }

  // ------------------------------------------------------------------ UI
  const host = document.createElement("div");
  host.id = "mentari-assistant-root";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; display: block; margin: 0 0 14px; }
      .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
             padding: 10px 12px; border: 1px solid rgba(128,128,128,.35); border-radius: 10px;
             background: rgba(127,127,127,.08); color: inherit;
             font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
      .bar .title { font-weight: 700; margin-right: 4px; color: #6b7280; }
      .wrap { display: contents; }
      button { border: 0; border-radius: 8px; padding: 8px 13px; color: #fff; cursor: pointer;
               font: inherit; font-weight: 600; }
      button:hover { filter: brightness(1.08); }
      button:disabled { opacity: .65; cursor: wait; }
      .menu { background: #1E3A8A; }
      .quiz { background: #2563EB; }
      .quiz.haiku, .sum.haiku { background: #C2410C; }
      .quiz.deep, .sum.deep { background: #1D4ED8; }
      .kue { background: #D97706; }
      .sum { background: #059669; }
      .set { background: #475569; }
      .forum { background: #7C3AED; }
      .fpanel { margin-top: 10px; width: 100%; max-width: 760px; background: #fff; color: #111827;
                border: 1px solid rgba(128,128,128,.35); border-radius: 10px; padding: 14px 16px;
                box-sizing: border-box; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
      .fpanel header { display: flex; justify-content: space-between; align-items: center; font-weight: 700; margin-bottom: 8px; }
      .fpanel header button { background: #e5e7eb; color: #111827; padding: 4px 10px; }
      .fpanel label { display: block; font-weight: 600; font-size: 13px; margin: 10px 0 4px; }
      .fpanel textarea, .fpanel select { width: 100%; box-sizing: border-box; font-family: inherit; font-size: 13px; line-height: 1.5; padding: 8px; border: 1px solid #cbd5e1; border-radius: 8px;
                background: #f8fafc; color: inherit; }
      .fpanel textarea { resize: vertical; }
      .fpanel .q { min-height: 110px; }
      .fpanel .n { min-height: 44px; }
      .fpanel .a { min-height: 200px; background: #f5f3ff; border-color: #c4b5fd; }
      .fpanel .row { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
      .fpanel .row select { width: auto; flex: 1; }
      .fpanel .row button { box-shadow: none; padding: 8px 14px; }
      .fpanel button:disabled { opacity: .6; cursor: wait; }
      .fpanel .gen { background: #7C3AED; }
      .fpanel .gen.haiku { background: #C2410C; }
      .fpanel .gen.ask { background: #0E7490; }
      .fpanel .gen.ask.haiku { background: #B45309; }
      .fpanel .gen.deep { background: #1D4ED8; }
      .fpanel .gen.ask.deep { background: #0369A1; }
      .fpanel .copy { background: #059669; }
      .fpanel .ghost { background: #e5e7eb; color: #111827; }
      .fpanel .meta { font-size: 12px; color: #64748b; margin-left: auto; }
      .hidden { display: none !important; }
      .panel { margin-top: 10px; max-height: 60vh; overflow: auto; background: #fff; color: #111827;
               border: 1px solid rgba(128,128,128,.35); border-radius: 10px; padding: 14px 16px;
               white-space: pre-wrap; box-sizing: border-box;
               font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
      .panel header { display: flex; justify-content: space-between; align-items: center;
                      font-weight: 700; margin-bottom: 8px; white-space: normal; }
      .panel header button { background: #e5e7eb; color: #111827; box-shadow: none; padding: 4px 10px; }
      .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
               background: #111827; color: #fff; padding: 9px 16px; border-radius: 8px;
               z-index: 2147483647; box-shadow: 0 4px 14px rgba(0,0,0,.3); pointer-events: none; }
      @media (prefers-color-scheme: dark) {
        .panel { background: #1f2937; color: #f3f4f6; }
        .bar .title { color: #9ca3af; }
        .panel header button { background: #374151; color: #f3f4f6; }
        .fpanel { background: #1f2937; color: #f3f4f6; }
        .fpanel header button, .fpanel .ghost { background: #374151; color: #f3f4f6; }
        .fpanel textarea, .fpanel select { background: #111827; border-color: #4b5563; }
        .fpanel .a { background: #2e1065; border-color: #6d28d9; }
        .fpanel .meta { color: #9ca3af; }
      }
    </style>
    <div class="bar">
    <span class="title">⚡ Mentari Assistant</span>
    <div class="wrap">
      <button class="quiz hidden" data-act="quiz" data-provider="groq">🤖 Auto Kuis · Groq</button>
      <button class="quiz haiku hidden" data-act="quiz" data-provider="classai">🤖 Auto Kuis · Haiku</button>
      <button class="quiz deep hidden" data-act="quiz" data-provider="deepseek">🤖 Auto Kuis · DeepSeek</button>
      <button class="kue hidden" data-act="kue">📋 Kuesioner</button>
      <button class="forum hidden" data-act="forum">💬 Forum Diskusi</button>
      <button class="sum hidden" data-act="sum" data-provider="groq">📖 Ringkas · Groq</button>
      <button class="sum haiku hidden" data-act="sum" data-provider="classai">📖 Ringkas · Haiku</button>
      <button class="sum deep hidden" data-act="sum" data-provider="deepseek">📖 Ringkas · DeepSeek</button>
      <button class="set hidden" data-act="set">⚙️ Pengaturan</button>
      <button class="menu" data-act="menu" title="Tampilkan/sembunyikan fitur lainnya">☰ Fitur lain</button>
    </div>
    </div>
    <div class="panel hidden"><header><span id="sumTitle">📖 Ringkasan</span><button data-act="close">✕</button></header><div class="body"></div></div>
    <div class="fpanel hidden">
      <header><span>💬 Asisten Forum Diskusi</span><button data-act="fclose">✕</button></header>
      <label for="fq">Soal dosen / postingan teman</label>
      <textarea id="fq" class="q" placeholder="Paste soal forum diskusi dari dosen di sini..."></textarea>
      <label for="fn">Catatan tambahan (opsional)</label>
      <textarea id="fn" class="n" placeholder="Mis. pakai contoh dari dunia kerja, sudut pandang tertentu..."></textarea>
      <div class="row">
        <select id="flen" title="Panjang jawaban">
          <option value="singkat">Singkat (±1 paragraf)</option>
          <option value="sedang" selected>Sedang (±2–3 paragraf)</option>
          <option value="panjang">Panjang (±4–5 paragraf)</option>
        </select>
        <button class="gen" data-act="fgen" data-provider="groq">⚡ Jawab · Groq</button>
        <button class="gen haiku" data-act="fgen" data-provider="classai">🧠 Jawab · Haiku</button>
        <button class="gen deep hidden" data-act="fgen" data-provider="deepseek">🐋 Jawab · DeepSeek</button>
      </div>
      <div class="row">
        <button class="gen ask" data-act="fask" data-provider="groq">❓ Buat Pertanyaan · Groq</button>
        <button class="gen ask haiku" data-act="fask" data-provider="classai">❓ Buat Pertanyaan · Haiku</button>
        <button class="gen ask deep hidden" data-act="fask" data-provider="deepseek">❓ Buat Pertanyaan · DeepSeek</button>
      </div>
      <label for="fa">Hasil AI: jawaban atau pertanyaan (siap copy-paste)</label>
      <textarea id="fa" class="a" placeholder="Jawaban dari AI muncul di sini..."></textarea>
      <div class="row">
        <button class="copy" data-act="fcopy">📋 Salin Jawaban</button>
        <button class="ghost" data-act="fclear">Bersihkan</button>
        <span class="meta" id="fmeta"></span>
      </div>
    </div>
  `;
  // Toolbar ditempel di bagian atas area konten halaman (bukan melayang).
  // Lewati elemen pengganjal kosong di awal konten (mis. spacer MuiToolbar di bawah header fixed),
  // supaya toolbar tidak tertutup header "Dashboard".
  function isSpacer(el) {
    if (el === host) return true;
    if (el.matches?.(".MuiToolbar-root, [class*='toolbar' i], [class*='spacer' i]") && !(el.innerText || "").trim()) return true;
    if (!(el.innerText || el.textContent || "").trim() && !el.querySelector?.("img, table, input, textarea, video, iframe, canvas")) return true;
    return false;
  }
  function firstContentChild(parent) {
    return [...parent.children].find((c) => !isSpacer(c)) || null;
  }
  function findMountTarget() {
    const ok = (el) => el && !el.closest("#mentari-assistant-root, nav, aside, header, .MuiAppBar-root") && isVisible(el);
    for (const sel of ["main .MuiContainer-root", "main", "[role='main']", ".MuiContainer-root"]) {
      const el = [...document.querySelectorAll(sel)].find(ok);
      if (el) return { parent: el, before: firstContentChild(el) };
    }
    // Cadangan: sebelum judul/tabel/form pertama di konten.
    const first = [...document.querySelectorAll("h1, h2, h3, h4, table, form")].find(ok);
    if (first?.parentElement) return { parent: first.parentElement, before: first };
    return { parent: document.body, before: firstContentChild(document.body) };
  }

  // Elemen fixed/sticky (header) yang menutupi toolbar, jika ada.
  function coveringBar() {
    const r = host.getBoundingClientRect();
    if (!r.height || r.bottom < 0 || r.top > innerHeight) return null;
    for (const fx of [0.2, 0.5, 0.8]) {
      const x = r.left + r.width * fx, y = r.top + Math.min(r.height / 2, 20);
      if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) continue;
      let el = document.elementFromPoint(x, y);
      if (!el || el === host || host.contains(el)) continue;
      while (el && el !== document.body) {
        const pos = getComputedStyle(el).position;
        if (pos === "fixed" || pos === "sticky") {
          // Hanya bar di bagian atas (header), bukan sidebar setinggi layar atau elemen di bawah.
          const br = el.getBoundingClientRect();
          if (br.top <= 10 && br.height < innerHeight * 0.4) return el;
          break;
        }
        el = el.parentElement;
      }
    }
    return null;
  }
  function scrolledToTop() {
    if (scrollY > 5) return false;
    for (let el = host.parentElement; el && el !== document.body; el = el.parentElement) {
      if (el.scrollTop > 5) return false;
    }
    return true;
  }
  function fixOverlap() {
    if (!scrolledToTop()) return; // saat discroll, wajar toolbar lewat di bawah header
    const bar = coveringBar();
    if (!bar) return;
    const gap = bar.getBoundingClientRect().bottom - host.getBoundingClientRect().top;
    if (gap > 0) {
      const cur = parseFloat(host.style.marginTop) || 0;
      host.style.marginTop = Math.min(cur + gap + 10, 400) + "px";
    }
  }

  let mountedParent = null;
  function mountUI() {
    const { parent, before } = findMountTarget();
    if (host.isConnected && host.parentElement === parent && mountedParent === parent) {
      fixOverlap();
      return;
    }
    host.style.marginTop = "";
    parent.insertBefore(host, before && before !== host ? before : null);
    mountedParent = parent;
    requestAnimationFrame(fixOverlap);
  }
  mountUI();

  const $ = (s) => shadow.querySelector(s);
  const btnQuizGroq = $('[data-act="quiz"][data-provider="groq"]');
  const btnQuizHaiku = $('[data-act="quiz"][data-provider="classai"]');
  const btnQuizDeep = $('[data-act="quiz"][data-provider="deepseek"]');
  const quizBtns = { groq: btnQuizGroq, classai: btnQuizHaiku, deepseek: btnQuizDeep };
  const btnKue = $('[data-act="kue"]');
  const btnSums = [...shadow.querySelectorAll('[data-act="sum"]')];
  const sumTitle = $("#sumTitle");
  const btnSet = $('[data-act="set"]');
  const panel = $(".panel");
  const panelBody = $(".panel .body");
  const fpanel = $(".fpanel");
  const btnForum = $('[data-act="forum"]');
  const fq = $("#fq"), fn = $("#fn"), fa = $("#fa"), flen = $("#flen"), fmeta = $("#fmeta");
  const btnGens = [...shadow.querySelectorAll('[data-act="fgen"], [data-act="fask"]')];

  const DRAFT_KEY = "mentariForumDraft";
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "{}");
    fq.value = d.q || ""; fn.value = d.n || ""; fa.value = d.a || ""; if (d.len) flen.value = d.len;
  } catch {}
  function saveDraft() {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ q: fq.value, n: fn.value, a: fa.value, len: flen.value }));
    } catch {}
    const words = fa.value.trim() ? fa.value.trim().split(/\s+/).length : 0;
    fmeta.textContent = words ? `${words} kata` : "";
  }
  [fq, fn, fa, flen].forEach((el) => el.addEventListener("input", saveDraft));
  ["keydown", "keyup", "keypress"].forEach((t) => fpanel.addEventListener(t, (e) => e.stopPropagation()));
  saveDraft();
  let menuOpen = false;
  let ctx = detect();

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    shadow.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  function render() {
    const showQuiz = ctx.isQuiz || (menuOpen && ctx.hasRadios && !ctx.isKuesioner);
    Object.values(quizBtns).forEach((b) => b.classList.toggle("hidden", !showQuiz));
    btnKue.classList.toggle("hidden", !(ctx.isKuesioner || (menuOpen && !ctx.isQuiz)));
    btnSums.forEach((b) => b.classList.toggle("hidden", !menuOpen || ctx.isQuiz));
    // Sembunyikan tombol AI yang API key-nya kosong
    shadow.querySelectorAll(".quiz[data-provider], .sum[data-provider]").forEach((b) => {
      if (!hasKey[b.dataset.provider]) b.classList.add("hidden");
    });
    shadow.querySelectorAll(".fpanel [data-provider]").forEach((b) => b.classList.toggle("hidden", !hasKey[b.dataset.provider]));
    btnForum.classList.toggle("hidden", ctx.isQuiz || !anyKey() || !(ctx.isForum || menuOpen));
    if (!anyKey()) fpanel.classList.add("hidden");
    btnSet.classList.toggle("hidden", !menuOpen);
  }

  shadow.addEventListener("click", async (e) => {
    const actEl = e.target.closest("[data-act]");
    const act = actEl?.dataset.act;
    const provider = actEl?.dataset.provider || "groq";
    if (act === "menu") {
      menuOpen = !menuOpen; render();
    }
    if (act === "set") chrome.runtime.sendMessage({ type: "openOptions" });
    if (act === "close") panel.classList.add("hidden");
    if (act === "quiz") {
      panel.classList.add("hidden");
      fpanel.classList.add("hidden");
      await runAutoQuizAll(false, provider);
    }
    if (act === "forum") {
      panel.classList.add("hidden");
      fpanel.classList.toggle("hidden");
      if (!fpanel.classList.contains("hidden")) (fq.value ? fa : fq).focus();
    }
    if (act === "fclose") fpanel.classList.add("hidden");
    if (act === "fclear") { fq.value = fn.value = fa.value = ""; saveDraft(); fq.focus(); }
    if (act === "fcopy") {
      if (!fa.value.trim()) return toast("Belum ada jawaban untuk disalin");
      try { await navigator.clipboard.writeText(fa.value); }
      catch { fa.select(); document.execCommand("copy"); }
      toast("📋 Jawaban disalin — paste ke kolom balasan forum");
    }
    if (act === "fgen" || act === "fask") {
      const question = fq.value.trim();
      if (question.length < 10) { fq.focus(); return toast("Paste dulu soal dari dosen / postingan teman"); }
      const origText = actEl.textContent;
      btnGens.forEach((b) => (b.disabled = true));
      actEl.textContent = `⏳ ${PROVIDER_LABEL[provider]}...`;
      try {
        const res = await chrome.runtime.sendMessage({
          type: act === "fask" ? "forumQuestion" : "forumAnswer",
          question, provider, notes: fn.value.trim(), length: flen.value
        });
        if (res?.ok) {
          fa.value = res.text; saveDraft();
          toast(`✅ ${act === "fask" ? "Pertanyaan" : "Jawaban"} dari ${PROVIDER_LABEL[provider]}`);
        }
        else toast("❌ " + (res?.error || "Gagal membuat jawaban"));
      } catch (err) {
        toast("❌ Extension dimuat ulang — refresh halaman ini");
      } finally {
        btnGens.forEach((b) => (b.disabled = false));
        actEl.textContent = origText;
      }
    }
    if (act === "kue") {
      const label = settings.kuesionerMode === "tidak" ? "TIDAK" : "YA / Positif";
      const n = fillKuesioner(settings.kuesionerMode);
      toast(n ? `📋 Kuesioner (${label}) terisi: ${n} pertanyaan` : "📋 Tidak ada pertanyaan kosong");
    }
    if (act === "sum") {
      fpanel.classList.add("hidden");
      if (detect().isQuiz) return toast("Ringkasan dinonaktifkan di halaman kuis");
      const text = pageText();
      if (text.length < 200) return toast("Teks materi di halaman ini terlalu sedikit");
      panel.classList.remove("hidden");
      sumTitle.textContent = `📖 Ringkasan · ${PROVIDER_LABEL[provider]}`;
      panelBody.textContent = `⏳ Meringkas materi pakai ${PROVIDER_LABEL[provider]}...`;
      const res = await chrome.runtime.sendMessage({ type: "summarize", text, provider });
      panelBody.textContent = res?.ok ? res.text : "❌ " + (res?.error || "Gagal");
    }
  });

  // --------------------------------------------------------- loop deteksi
  let lastType = "";
  function tick() {
    ctx = detect();
    const type = ctx.isQuiz ? "quiz" : ctx.isKuesioner ? "kuesioner" : "none";
    if (type !== lastType) {
      lastType = type;
      if (type === "quiz") {
        panel.classList.add("hidden");
        fpanel.classList.add("hidden");
      }
    }
    if (settings.autoKuis && !quizBusy && !ctx.isForum && !ctx.isKuesioner) {
      // Soal belum tampil -> cari tombol Mulai. Soal sudah tampil -> jawab semua lalu Selesai.
      // Tanpa API key sama sekali: jangan mulai kuis (waktunya jalan tapi tidak ada AI yang menjawab).
      const prov = quizProvider();
      if (prov && !getQuizGroups().length) autoStartQuiz();
      else if (prov && ctx.isQuiz) runAutoQuizAll(true, prov);
    }
    if (ctx.kuesionerStrong && settings.autoKuesioner) {
      const n = fillKuesioner(settings.kuesionerMode);
      if (n) toast(`📋 Kuesioner terisi otomatis: ${n} pertanyaan — cek lalu klik Kirim`);
    }
    mountUI();
    injectForumReplyAiButtons();
    render();
  }

  tick();
  setInterval(tick, 1200);
  addEventListener("popstate", tick);
  addEventListener("hashchange", tick);
})();
