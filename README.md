# Mentari Assistant (Android)

Aplikasi Android untuk mentari.unpam.ac.id. Aplikasi ini menjalankan kode yang sama dengan extension
browser "Mentari UNPAM Assistant", jadi semua fiturnya ikut:

- Auto kuis: mulai sendiri, menjawab semua soal, lalu klik Selesai. Kuis yang sudah selesai tidak diulang.
- Forum diskusi: tombol ⚡ AI Groq / 🧠 AI Haiku untuk menjawab, ❓ Tanya untuk membuat pertanyaan,
  dan jawaban masuk ke kolom reply postingan yang diklik.
- Kuesioner terisi otomatis.
- Copy-paste di editor Advance tidak diblokir.
- Toolbar menempel di halaman, tidak melayang.

## Cloudflare / layar putih

Aplikasi lama bisa blank putih saat Cloudflare meminta verifikasi. Di aplikasi ini:
- User-Agent memakai bawaan WebView (tidak dipalsukan), supaya verifikasi Cloudflare tidak gagal.
- Script fitur tidak mengubah objek bawaan browser (`fetch`, `chrome`) dan tidak dijalankan
  di halaman verifikasi "Just a moment...".
- Kalau halaman tetap kosong, aplikasi memuat ulang sekali secara otomatis, lalu menampilkan tombol
  **⟳ Muat ulang** / **Ke beranda Mentari**. Kalau proses WebView crash, aplikasi memulihkan diri.

## API key

Tidak ada API key di dalam APK. Isi key secara manual di aplikasi lewat **☰ Fitur lain → ⚙️ Pengaturan**.
Halaman Pengaturan juga terbuka otomatis saat aplikasi pertama kali dibuka.

- Key hanya tersimpan di HP dan tidak pernah dibaca oleh JavaScript halaman Mentari.
  Request ke Groq/ClassAI dikirim dari sisi Android, dan key ditambahkan di sana.
- Groq: console.groq.com/keys
- ClassAI (Claude Haiku 5.5): router.classai.id

## Build APK (GitHub Actions)

1. Buat repository baru di GitHub (boleh private), lalu push isi folder ini:
   ```bash
   cd mentari-android
   git init
   git add .
   git commit -m "Mentari Assistant Android"
   git branch -M main
   git remote add origin https://github.com/<akun-kamu>/<nama-repo>.git
   git push -u origin main
   ```
2. Buka tab **Actions** di repository. Workflow **Build Mentari Assistant APK** berjalan otomatis
   (bisa juga dijalankan manual dengan **Run workflow**).
3. Setelah selesai (hijau), buka run tersebut, lalu unduh artifact **Mentari-Assistant-APK**.
   Isinya `app-debug.apk`.
4. Pindahkan APK ke HP dan pasang. Izinkan "Instal aplikasi tidak dikenal" kalau diminta.

Tidak perlu GitHub Secret apa pun.

## Memperbarui dari extension

Kalau extension di `../mentari-extension-v1.7.0` diperbarui:

```bash
./sync-extension.sh            # salin content.js, background.js, unblock.js, pastemain.js
git commit -am "Sinkron extension" && git push
```

## Struktur

- `app/src/main/assets/ext/`: kode extension (disalin oleh `sync-extension.sh`) dan `shim.js`,
  yang meniru `chrome.storage` dan `chrome.runtime` di WebView.
- `MainActivity.kt`: WebView, penyuntikan script sejak awal halaman, jembatan storage dan HTTP AI,
  upload file, dan unduhan.
- `SettingsActivity.kt`: API key dan pengaturan fitur.
- `Store.kt`: penyimpanan pengaturan dan API key (terpisah).

Aplikasi ini terpisah dari aplikasi lama `appsmentari-main`. Nama paketnya berbeda
(`com.unpam.mentari.assistant`), jadi keduanya bisa terpasang bersamaan.
