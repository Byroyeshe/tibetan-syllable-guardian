/**
 * Minimal UI i18n: loads ui_texts.json and exposes t(key, params).
 * Browser: window.TibetanI18n (data fetched from ui_texts.json, see .ready promise).
 * Node: module.exports (data read synchronously via fs).
 *
 * All UI text and log text go through t() so the interface follows the selected language.
 * Edit ui_texts.json to change any string — no code changes needed.
 */

(function () {
    'use strict';

    const LANGS = ['zh', 'en', 'bo'];
    const STORAGE_KEY = 'tsg_ui_lang';
    const DEFAULT_LANG = 'zh';

    let dict = null;      // { key: { zh, en, bo } }
    let lang = null;      // current language

    /**
     * Get a localized string by key, with {param} interpolation.
     * Falls back to English, then to the key itself.
     */
    function t(key, params) {
        let s = key;
        const entry = dict ? dict[key] : null;
        if (entry) {
            s = (entry[lang] !== undefined && entry[lang] !== '')
                ? entry[lang]
                : (entry.en !== undefined && entry.en !== '') ? entry.en : key;
        }
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                s = s.split('{' + k + '}').join(String(v));
            }
        }
        return s;
    }

    function setLang(l) {
        if (LANGS.includes(l)) {
            lang = l;
            try {
                if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, l);
            } catch (e) { /* storage unavailable — ignore */ }
        }
    }

    function getLang() { return lang; }

    if (typeof module !== 'undefined' && module.exports) {
        // ---------- Node.js: sync load ----------
        const fs = require('fs');
        try {
            dict = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'ui_texts.json'), 'utf8'));
        } catch (e) {
            dict = null;
            console.error('i18n: failed to load ui_texts.json', e);
        }
        lang = 'en'; // library default
        module.exports = { t, setLang, getLang, LANGS, getDict: function () { return dict; } };
    } else {
        // ---------- Browser: async load + persistence ----------
        // Restore the saved language (default: zh)
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            lang = (saved && LANGS.includes(saved)) ? saved : DEFAULT_LANG;
        } catch (e) {
            lang = DEFAULT_LANG;
        }

        const ready = fetch('ui_texts.json', {
            cache: 'no-cache',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        })
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(d => { dict = d; })
            .catch(err => {
                console.error('i18n: failed to load ui_texts.json:', err);
                dict = null;
            });

        window.TibetanI18n = { t, setLang, getLang, LANGS, ready };
    }
})();
