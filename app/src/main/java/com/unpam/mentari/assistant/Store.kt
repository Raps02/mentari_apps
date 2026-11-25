package com.unpam.mentari.assistant

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Penyimpanan untuk shim chrome.storage.local (pengaturan extension) dan API key.
 * API key disimpan terpisah dan TIDAK pernah diberikan ke JavaScript halaman;
 * JS hanya melihat penanda "__android__" supaya background.js tahu key sudah diisi.
 */
object Store {
    private const val DATA_PREFS = "ext_storage"
    private const val DATA_KEY = "data"
    private const val SECRET_PREFS = "secrets"
    private val SECRET_KEYS = setOf("groqApiKey", "classaiApiKey", "deepseekApiKey")
    private const val PLACEHOLDER = "__android__"
    private val lock = Any()

    fun secrets(ctx: Context): SharedPreferences = ctx.getSharedPreferences(SECRET_PREFS, Context.MODE_PRIVATE)
    fun groqKey(ctx: Context): String = secrets(ctx).getString("groqApiKey", "") ?: ""
    fun classaiKey(ctx: Context): String = secrets(ctx).getString("classaiApiKey", "") ?: ""
    fun deepseekKey(ctx: Context): String = secrets(ctx).getString("deepseekApiKey", "") ?: ""

    fun setKeys(ctx: Context, groq: String, classai: String, deepseek: String) {
        val clean = { v: String -> v.trim().trim('"', '\'') }
        secrets(ctx).edit()
            .putString("groqApiKey", clean(groq))
            .putString("classaiApiKey", clean(classai))
            .putString("deepseekApiKey", clean(deepseek))
            .apply()
    }

    fun data(ctx: Context): JSONObject = synchronized(lock) {
        val raw = ctx.getSharedPreferences(DATA_PREFS, Context.MODE_PRIVATE).getString(DATA_KEY, "{}") ?: "{}"
        try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
    }

    private fun save(ctx: Context, obj: JSONObject) {
        ctx.getSharedPreferences(DATA_PREFS, Context.MODE_PRIVATE).edit().putString(DATA_KEY, obj.toString()).apply()
    }

    /** Data untuk JavaScript: pengaturan + penanda key (bukan key aslinya). */
    fun dataForJs(ctx: Context): JSONObject {
        val obj = data(ctx)
        SECRET_KEYS.forEach { obj.remove(it) }
        if (groqKey(ctx).isNotEmpty()) obj.put("groqApiKey", PLACEHOLDER)
        if (classaiKey(ctx).isNotEmpty()) obj.put("classaiApiKey", PLACEHOLDER)
        if (deepseekKey(ctx).isNotEmpty()) obj.put("deepseekApiKey", PLACEHOLDER)
        return obj
    }

    fun merge(ctx: Context, items: JSONObject) = synchronized(lock) {
        val obj = data(ctx)
        items.keys().forEach { k -> if (k !in SECRET_KEYS) obj.put(k, items.get(k)) }
        save(ctx, obj)
    }

    fun remove(ctx: Context, keys: JSONArray) = synchronized(lock) {
        val obj = data(ctx)
        for (i in 0 until keys.length()) obj.remove(keys.optString(i))
        save(ctx, obj)
    }

    fun put(ctx: Context, key: String, value: Any) = merge(ctx, JSONObject().put(key, value))
}
