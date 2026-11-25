package com.unpam.mentari.assistant

import android.app.Activity
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** Padanan options.html extension: API key (manual) dan pengaturan fitur. */
class SettingsActivity : Activity() {

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "Pengaturan Mentari Assistant"
        val data = Store.data(this)

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(24))
        }
        fun heading(t: String) = col.addView(TextView(this).apply {
            text = t
            setTypeface(typeface, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setPadding(0, dp(18), 0, dp(6))
        })
        fun note(t: String) = col.addView(TextView(this).apply {
            text = t
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            alpha = 0.7f
        })
        fun keyField(hint: String, value: String) = EditText(this).apply {
            this.hint = hint
            setText(value)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true
        }.also { col.addView(it, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)) }
        fun check(label: String, checked: Boolean) = CheckBox(this).apply {
            text = label
            isChecked = checked
        }.also { col.addView(it) }
        fun radios(options: List<Pair<String, String>>, selected: String): RadioGroup {
            val g = RadioGroup(this)
            options.forEachIndexed { i, (value, label) ->
                g.addView(RadioButton(this).apply { id = 1000 + i; text = label; tag = value; isChecked = value == selected })
            }
            col.addView(g)
            return g
        }
        fun RadioGroup.value(default: String): String =
            (findViewById<RadioButton>(checkedRadioButtonId)?.tag as? String) ?: default

        heading("API Key")
        note("Diisi manual dan hanya tersimpan di HP ini. Tidak dikirim ke halaman Mentari.")
        val groq = keyField("Groq API Key (gsk_...)", Store.groqKey(this))
        note("Untuk tombol ⚡ Groq. Ambil di console.groq.com/keys")
        val classai = keyField("ClassAI API Key (sk_live_...)", Store.classaiKey(this))
        note("Untuk tombol 🧠 Haiku (Claude Haiku 5.5). Ambil di router.classai.id")
        val deepseek = keyField("DeepSeek API Key (sk-...) — opsional", Store.deepseekKey(this))
        note("Untuk tombol 🐋 DeepSeek. Saldo top-up tidak hangus. Ambil di platform.deepseek.com")
        note("Tombol AI hanya muncul untuk key yang diisi. Kosongkan key untuk menyembunyikan tombolnya.")

        heading("Auto Kuis")
        val autoKuis = check("🤖 Otomatis: mulai kuis dan jawab semua soal saat halaman kuis dibuka", data.optBoolean("autoKuis", true))
        val autoFinish = check("🏁 Otomatis klik Selesai & konfirmasi setelah semua soal terjawab", data.optBoolean("autoKuisFinish", true))
        note("AI untuk Auto Kuis otomatis:")
        val provider = radios(listOf("groq" to "⚡ Groq", "classai" to "🧠 Claude Haiku 5.5 (ClassAI)", "deepseek" to "🐋 DeepSeek"), data.optString("autoKuisProvider", "groq"))

        heading("Kuesioner")
        val autoKue = check("Isi kuesioner otomatis saat halaman kuesioner dibuka", data.optBoolean("autoKuesioner", true))
        val mode = radios(listOf("ya" to "YA / Positif", "tidak" to "TIDAK / Negatif"), data.optString("kuesionerMode", "ya"))

        col.addView(Button(this).apply {
            text = "Simpan"
            setOnClickListener {
                Store.setKeys(this@SettingsActivity, groq.text.toString(), classai.text.toString(), deepseek.text.toString())
                Store.put(this@SettingsActivity, "autoKuis", autoKuis.isChecked)
                Store.put(this@SettingsActivity, "autoKuisFinish", autoFinish.isChecked)
                Store.put(this@SettingsActivity, "autoKuisProvider", provider.value("groq"))
                Store.put(this@SettingsActivity, "autoKuesioner", autoKue.isChecked)
                Store.put(this@SettingsActivity, "kuesionerMode", mode.value("ya"))
                Toast.makeText(this@SettingsActivity, "✅ Tersimpan", Toast.LENGTH_SHORT).show()
                finish()
            }
        }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(24) })

        setContentView(ScrollView(this).apply { addView(col) })
    }
}
