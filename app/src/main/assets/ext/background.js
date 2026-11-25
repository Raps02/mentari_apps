// Service worker: memanggil Groq API (content script tidak bisa fetch lintas origin di MV3).
const MODELS = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

async function callGroq(apiKey, system, user, maxTokens, temperature = 0.3, effort = "medium") {
  const errors = [];
  let truncated = ""; // jawaban yang terpotong, dipakai hanya jika semua model gagal
  for (const model of MODELS) {
    try {
      const isReasoning = model.startsWith("openai/gpt-oss");
      const body = {
        model,
        // Model reasoning memakai sebagian token untuk "berpikir", jadi butuh budget lebih besar
        // supaya jawaban akhirnya tidak terpotong.
        max_tokens: isReasoning ? maxTokens + (effort === "low" ? 1500 : 3000) : maxTokens,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      };
      // "low" untuk kuis (cepat), "medium" untuk forum (jawaban lebih lengkap).
      if (isReasoning) body.reasoning_effort = effort;
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        errors.push(`${model} (HTTP ${res.status})`);
        continue;
      }
      const data = await res.json();
      const choice = data?.choices?.[0];
      const text = choice?.message?.content?.trim();
      if (text && choice.finish_reason === "length") {
        if (text.length > truncated.length) truncated = text;
        errors.push(`${model} (jawaban terpotong)`);
        continue;
      }
      if (text) return text;
      errors.push(`${model} (respons kosong)`);
    } catch (e) {
      errors.push(`${model} (${e.message})`);
    }
  }
  if (truncated) return truncated;
  throw new Error("Gagal memanggil AI: " + errors.join(" | ").slice(0, 200));
}

// ClassAI Router (classai.id) — kompatibel OpenAI Chat Completions.
const CLASSAI_URL = "https://router.classai.id/v1/chat/completions";
const CLASSAI_MODEL = "claude-haiku-5.5";

async function callClassAI(apiKey, system, user, maxTokens, temperature = 0.3) {
  let res;
  try {
    res = await fetch(CLASSAI_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: CLASSAI_MODEL,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
  } catch (e) {
    throw new Error("Gagal menghubungi ClassAI: " + e.message);
  }
  if (!res.ok) {
    let detail = "";
    try { const j = await res.json(); detail = j?.error?.message || j?.message || ""; } catch {}
    throw new Error(`ClassAI HTTP ${res.status}${detail ? ": " + detail : ""}`.slice(0, 200));
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  const out = (Array.isArray(text) ? text.map((p) => p?.text || "").join("") : String(text || "")).trim();
  if (!out) throw new Error("ClassAI mengembalikan respons kosong");
  return out;
}

// DeepSeek (api.deepseek.com) — kompatibel OpenAI Chat Completions. Saldo top-up tidak hangus.
// Nama model berganti-ganti; dicoba berurutan dari yang terbaru ke nama lama.
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-flash", "deepseek-chat"];

async function callDeepSeek(apiKey, system, user, maxTokens, temperature = 0.3) {
  const errors = [];
  for (const model of DEEPSEEK_MODELS) {
    let res;
    try {
      res = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        })
      });
    } catch (e) {
      throw new Error("Gagal menghubungi DeepSeek: " + e.message);
    }
    if (!res.ok) {
      let detail = "";
      try { const j = await res.json(); detail = j?.error?.message || j?.message || ""; } catch {}
      // Key salah / saldo habis: tidak ada gunanya mencoba model lain.
      if (res.status === 401) throw new Error("DeepSeek API Key tidak valid (HTTP 401)");
      if (res.status === 402) throw new Error("Saldo DeepSeek habis (HTTP 402). Top up di platform.deepseek.com");
      errors.push(`${model} (HTTP ${res.status}${detail ? ": " + detail : ""})`);
      continue; // mis. nama model tidak dikenal -> coba nama berikutnya
    }
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || "").trim();
    if (text) return text;
    errors.push(`${model} (respons kosong)`);
  }
  throw new Error("Gagal memanggil DeepSeek: " + errors.join(" | ").slice(0, 200));
}

// Pilih penyedia AI sesuai tombol yang diklik: "groq", "classai", atau "deepseek".
async function callAI(provider, system, user, maxTokens, temperature, effort = "medium") {
  if (provider === "deepseek") {
    const { deepseekApiKey } = await chrome.storage.local.get("deepseekApiKey");
    if (!deepseekApiKey) throw new Error("DeepSeek API Key belum diatur. Klik ikon extension untuk mengisinya.");
    return callDeepSeek(deepseekApiKey, system, user, maxTokens, temperature);
  }
  if (provider === "classai") {
    const { classaiApiKey } = await chrome.storage.local.get("classaiApiKey");
    if (!classaiApiKey) throw new Error("ClassAI API Key belum diatur. Klik ikon extension untuk mengisinya.");
    return callClassAI(classaiApiKey, system, user, maxTokens, temperature);
  }
  const { groqApiKey } = await chrome.storage.local.get("groqApiKey");
  if (!groqApiKey) throw new Error("Groq API Key belum diatur. Klik ikon extension untuk mengisinya.");
  return callGroq(groqApiKey, system, user, maxTokens, temperature, effort);
}

// Hapus seluruh simbol markdown (**bold**, *italic*, ### heading, backtick, em-dash) agar siap copy-paste natural.
function cleanPlainText(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/__([\s\S]*?)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?;:]|$)/g, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?;:]|$)/g, "$1$2")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/\*\*/g, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeAnswerIndex(val) {
  if (typeof val === "number" && Number.isInteger(val)) return val;
  const s = String(val ?? "").trim();
  if (/^\d+$/.test(s)) return Number(s);
  const letter = s.match(/^([A-Za-z])(?:[.)\s]|$)/);
  if (letter) return letter[1].toUpperCase().charCodeAt(0) - 65;
  return NaN;
}

function parseQuizJson(raw) {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  let arr = null;
  if (match) {
    arr = JSON.parse(match[0]);
  } else {
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      const obj = JSON.parse(objMatch[0]);
      if (Array.isArray(obj.answers)) arr = obj.answers;
      else if (obj.answer !== undefined) arr = [obj];
    }
  }
  if (!Array.isArray(arr)) throw new Error("Format jawaban AI tidak valid");
  return arr.map((item) => ({
    id: Number(item.id ?? 0),
    answer: normalizeAnswerIndex(item.answer)
  }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "summarize") {
    (async () => {
      const system =
        "Kamu asisten belajar mahasiswa. Ringkas materi kuliah yang diberikan dalam Bahasa Indonesia: " +
        "poin-poin konsep utama, istilah penting beserta artinya, dan contoh singkat bila relevan. " +
        "Gunakan teks biasa dengan tanda '-' untuk poin, tanpa markdown tebal, bintang, atau pagar.";
      const raw = await callAI(msg.provider, system, msg.text, 1200, 0.3);
      return cleanPlainText(raw);
    })()
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === "forumAnswer") {
    (async () => {
      const panjang = {
        singkat: "sekitar 1 paragraf (80-150 kata)",
        sedang: "sekitar 2-3 paragraf (150-300 kata)",
        panjang: "sekitar 4-5 paragraf (300-500 kata)"
      }[msg.length] || "sekitar 2-3 paragraf (150-300 kata)";
      const isFriendReply = /POSTINGAN TEMAN YANG SAYA BALAS/.test(msg.question || "");
      const langkah = isFriendReply
        ? "LANGKAH KERJA (lakukan dalam pikiranmu, jangan ditulis):\n" +
          "a. Kamu sedang MEMBALAS POSTINGAN TEMAN, bukan menjawab soal dosen. Fokus ke bagian 'POSTINGAN TEMAN YANG SAYA BALAS'. " +
          "Bagian soal dosen hanya konteks topik, JANGAN dijawab ulang.\n" +
          "b. Pahami isi postingan teman: apakah dia bertanya, meminta pendapat, atau menyampaikan jawaban/argumen.\n" +
          "c. Jika teman bertanya, jawab SEMUA pertanyaannya secara langsung, lengkap, dan benar. " +
          "Jika teman menyampaikan pendapat/jawaban, tanggapi isinya secara spesifik: sebutkan bagian yang kamu setujui, " +
          "tambahkan penjelasan atau contoh yang belum dia bahas, dan luruskan dengan sopan jika ada yang kurang tepat.\n" +
          "d. Balasan harus jelas nyambung dengan apa yang ditulis teman (rujuk poin-poinnya), bukan jawaban umum tentang topik.\n\n" +
          `PANJANG: ${panjang}. Kalau teman mengajukan beberapa pertanyaan, semuanya wajib terjawab walau melebihi batas kata.\n\n` +
          "GAYA: seperti mahasiswa membalas teman sekelas di forum: ramah, sopan, natural, tetap akademis. " +
          "Boleh menyapa teman dengan namanya di awal jika namanya jelas terlihat (mis. 'Setuju dengan pendapat Andi, ...'), tapi jangan mengarang nama.\n\n"
        : "LANGKAH KERJA (lakukan dalam pikiranmu, jangan ditulis):\n" +
          "a. Temukan SOAL/PERTANYAAN dari dosen. Kalau ada bagian 'SOAL / TOPIK DISKUSI DARI DOSEN', itu soal utamanya.\n" +
          "b. Uraikan semua yang diminta: setiap nomor, setiap sub-pertanyaan, dan setiap kata kerja perintah " +
          "(jelaskan, sebutkan, bandingkan, berikan contoh, analisis, berikan pendapat, dst.). Perhatikan juga jumlah yang diminta (mis. 'sebutkan 3').\n" +
          "c. Jawab SEMUA bagian itu satu per satu dengan isi yang benar, spesifik, dan sesuai topik mata kuliahnya. " +
          "Tidak boleh ada bagian soal yang terlewat atau dijawab setengah-setengah.\n\n" +
          `PANJANG: ${panjang} untuk soal tunggal. Jika soal punya beberapa pertanyaan, setiap pertanyaan mendapat jawaban yang cukup lengkap ` +
          "(minimal 1 paragraf berisi). Kelengkapan dan ketepatan jawaban lebih penting daripada batas kata.\n\n" +
          "GAYA: bahasa natural, mengalir, dan membumi seperti ketikan mahasiswa sungguhan, tapi tetap akademis dan tepat istilah.\n\n";
      const system =
        "Kamu adalah mahasiswa S1 yang sedang membalas forum diskusi mata kuliah dalam Bahasa Indonesia. " +
        "Teks yang diberikan diambil otomatis dari halaman forum, jadi bisa berisi sisa teks halaman seperti nama, tanggal, atau tombol. Abaikan bagian itu.\n\n" +
        langkah +
        "ATURAN KETAT YANG WAJIB DIPATUHI:\n" +
        "1. DILARANG KERAS memakai simbol markdown apapun (tidak boleh ada **, *, #, _, atau backtick).\n" +
        "2. DILARANG memakai tanda pisah panjang (— atau –).\n" +
        "3. DILARANG memakai kalimat template/klise khas AI seperti 'Tentu, berikut...', 'Secara keseluruhan...', 'Dengan demikian, dapat disimpulkan...', atau 'Semoga membantu'.\n" +
        "4. Langsung jawab, tanpa mengulang soal/postingan. Jika ada beberapa pertanyaan bernomor, jawab berurutan memakai angka biasa (1., 2., dst.).\n" +
        "5. Jika diminta contoh, berikan contoh yang konkret. Jika diminta pendapat, berikan pendapat beserta alasannya.\n" +
        "6. Jangan mengarang referensi, kutipan, atau data statistik yang tidak ada di teks.";
      let user = msg.question;
      if (msg.notes) user += "\n\nCatatan tambahan dari saya:\n" + msg.notes;
      user += isFriendReply
        ? "\n\nTulis balasan forum untuk postingan teman di atas: jawab/tanggapi isi postingan teman tersebut secara lengkap, bukan soal dosennya."
        : "\n\nTulis jawaban forum yang menjawab SEMUA bagian soal di atas.";
      const raw = await callAI(msg.provider, system, user, 2500, 0.4);
      return cleanPlainText(raw);
    })()
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === "forumQuestion") {
    (async () => {
      const isFriend = /POSTINGAN TEMAN YANG SAYA BALAS/.test(msg.question || "");
      const system =
        "Kamu adalah mahasiswa S1 yang aktif di forum diskusi mata kuliah dan ingin MENGAJUKAN PERTANYAAN dalam Bahasa Indonesia. " +
        "Teks yang diberikan diambil otomatis dari halaman forum, jadi bisa berisi sisa teks seperti nama, tanggal, atau tombol. Abaikan bagian itu.\n\n" +
        (isFriend
          ? "Kamu bertanya kepada TEMAN tentang isi postingannya (bagian 'POSTINGAN TEMAN YANG SAYA BALAS'). Soal dosen hanya konteks topik. " +
            "Pertanyaan harus merujuk langsung ke poin yang ditulis teman: minta penjelasan lebih dalam, contoh nyata, alasan, " +
            "atau menguji argumennya dengan kasus lain. Boleh menyapa teman dengan namanya jika jelas terlihat, jangan mengarang nama.\n\n"
          : "Kamu bertanya tentang TOPIK/SOAL DISKUSI dari dosen. Pertanyaan harus memperdalam topik itu: penerapan nyata, " +
            "perbandingan konsep, kasus khusus, kelebihan/kekurangan, atau hal yang belum dibahas di soal.\n\n") +
        "KETENTUAN:\n" +
        "1. Buat 1 pertanyaan utama yang kritis, spesifik, dan relevan (boleh ditambah 1 pertanyaan lanjutan singkat). Bukan pertanyaan yang jawabannya cuma ya/tidak atau definisi dasar.\n" +
        "2. Awali dengan 1 sampai 2 kalimat pengantar singkat yang menunjukkan kamu memahami topik/postingan, lalu ajukan pertanyaannya.\n" +
        "3. Total sekitar 40 sampai 90 kata, gaya natural dan sopan seperti ketikan mahasiswa.\n" +
        "4. DILARANG memakai simbol markdown (**, *, #, _, backtick) dan tanda pisah panjang (— atau –).\n" +
        "5. DILARANG kalimat klise khas AI seperti 'Tentu, berikut...' atau 'Semoga membantu'. Jangan menjawab pertanyaanmu sendiri.";
      let user = msg.question;
      if (msg.notes) user += "\n\nCatatan tambahan dari saya:\n" + msg.notes;
      user += isFriend
        ? "\n\nBuat pertanyaan untuk teman berdasarkan postingannya di atas."
        : "\n\nBuat pertanyaan diskusi berdasarkan topik/soal dosen di atas.";
      const raw = await callAI(msg.provider, system, user, 700, 0.7);
      return cleanPlainText(raw);
    })()
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === "solveQuiz") {
    (async () => {
      const questions = Array.isArray(msg.questions) ? msg.questions : [];
      if (!questions.length) throw new Error("Tidak ada soal yang dikirim.");

      const system =
        "Kamu ahli akademik yang menjawab soal pilihan ganda kuliah dengan akurat. " +
        "Analisis setiap soal dan pilihan jawabannya dengan teliti. " +
        "WAJIB balas HANYA dengan JSON array valid tanpa teks tambahan atau markdown. " +
        'Format wajib: [{"id": 0, "answer": 2}] ' +
        'di mana "id" adalah id soal dan "answer" adalah angka indeks (dimulai dari 0) dari pilihan yang paling benar.';

      // Potongan soal dikirim paralel supaya halaman dengan banyak soal selesai lebih cepat.
      const CHUNK_SIZE = 10;
      const chunks = [];
      for (let i = 0; i < questions.length; i += CHUNK_SIZE) chunks.push(questions.slice(i, i + CHUNK_SIZE));
      const results = await Promise.all(chunks.map(async (chunk) => {
        const promptLines = chunk.map((q) => {
          const opts = q.options.map((o, idx) => `  [${idx}] ${o}`).join("\n");
          return `Soal id=${q.id}:\n${q.question}\nPilihan:\n${opts}`;
        });
        const userPrompt = "Jawab soal-soal berikut dalam format JSON array:\n\n" + promptLines.join("\n\n---\n\n");
        const raw = await callAI(msg.provider, system, userPrompt, 1024, 0.1, "low");
        return parseQuizJson(raw);
      }));
      const allAnswers = results.flat();
      return allAnswers;
    })()
      .then((answers) => sendResponse({ ok: true, answers }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
});

// Fitur notifikasi tugas baru sudah dihapus: bersihkan sisa data lamanya.
chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.local.remove(["notifiedKeys", "monitoredUrls", "notifTugas", "forumFiles"]);
  // Sekali saja: nyalakan auto mulai/jawab/selesai kuis (sebelumnya default mati).
  const { autoKuisV2 } = await chrome.storage.local.get("autoKuisV2");
  if (!autoKuisV2) {
    await chrome.storage.local.set({ autoKuis: true, autoKuisFinish: true, autoKuisV2: true });
  }
});
