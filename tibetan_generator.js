/**
 * Tibetan syllable generator
 * IME-style generation: given a set of Tibetan characters, generates all valid results in
 * "input order" —
 *   1. Single syllables: core syllables (prefix/superscript/base/subscript/vowel/suffix etc.)
 *   2. Particle attachments: full form འི འུ འེ འོ འང འམ (e.g. དག + འི = དགའི),
 *      and merged form ི ུ ེ ོ ང མ appended after a འ-ending core (e.g. མཁའ + ི = མཁའི);
 *      chains supported recursively (e.g. བདེ + འམ + འང = བདེའམའང)
 *   3. Multi-syllable words: adjacent two/three syllables joined by ་ (e.g. ག་ང, གངས་ཅན)
 * Key constraint: the input characters used by a result must form a CONTIGUOUS run (no gaps) —
 *   input ག ང ས ཅ ན only yields ག གང གངས ང ངས ས ཅ ཅན ན etc.,
 *   never gap-skipping syllables like གས གཅན གན.
 * Ordering: single-syllable -> two-syllable -> three-syllable; within a group by interval
 * start position -> end position (i.e. input order).
 * Validation reuses tibetan_algorithm.js prepareData / validateSyllablePath / checkSyllable to avoid drift.
 *
 * Note: the whole module is wrapped in an IIFE so its top-level consts (PARTICLE_MARKS / A_CHUNG etc.)
 * do not collide with tibetan_algorithm.js globals in the browser's shared scope.
 */

(function () {

// Reuse the algorithm library (browser: window.TibetanAlgorithm, Node: require)
// Resolve lazily at call time to avoid transient undefined from script order/caching
let TibetanAlgorithm = null;
function resolveAlgorithm() {
    if (!TibetanAlgorithm) {
        if (typeof window !== 'undefined' && window.TibetanAlgorithm) {
            TibetanAlgorithm = window.TibetanAlgorithm;
        } else if (typeof require === 'function') {
            TibetanAlgorithm = require('./tibetan_algorithm.js');
        }
    }
    return TibetanAlgorithm;
}

// Localized text via the shared i18n module (browser: window.TibetanI18n, Node: require('./i18n.js'))
let I18N = null;
function resolveI18n() {
    if (!I18N) {
        if (typeof window !== 'undefined' && window.TibetanI18n) {
            I18N = window.TibetanI18n;
        } else if (typeof require === 'function') {
            try { I18N = require('./i18n.js'); } catch (e) { I18N = null; }
        }
    }
    return I18N;
}
function lt(key, params) {
    const i18n = resolveI18n();
    return i18n ? i18n.t(key, params) : key;
}

// Particle marks and carrier (kept in sync with tibetan_algorithm.js)
const PARTICLE_MARKS = ['ི', 'ུ', 'ེ', 'ོ', 'ང', 'མ'];
const A_CHUNG = 'འ';

const MAX_RESULTS = 2000;        // max total results (protect the page from huge inputs)
const MAX_COMPOSE_UNITS = 300;   // max single syllables used for multi-syllable composition
const COMPOSE_BUDGET = MAX_RESULTS * 3; // intermediate budget for the composition stage
const MAX_EXPLORE = 200000;      // node cap for interval/role exploration (protect from huge inputs)

/** Compare index tuples element-wise (contiguous runs: start first, then end) */
function tupleCmp(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
}

/**
 * Generate all valid syllables and multi-syllable words from the given characters
 * @param {string[]} chars - Tibetan characters in input order, e.g. ['ག', 'ང']
 * @param {Object} data - raw Tibetan data object (sequenceTemplates, charTags, rawCombinationRules)
 * @param {Object} [opts] - options:
 *   autoSubscript: also insert ONE allowed subscript (per the "2-3" combination rule) after
 *     each base-capable char, so stacked (下加字) syllables generate WITHOUT variant input
 *     (used by the nine-grid, which can only press base letters). Superscripts (上加字)
 *     already generate via the built-in base-variant option.
 * @returns {string[]} deduplicated, input-order-sorted result array; sets .truncated = true if capped
 */
function generateSyllablesFromChars(chars, data, opts) {
    const algorithm = resolveAlgorithm();
    if (!algorithm || !algorithm.prepareData || !algorithm.validateSyllablePath || !algorithm.checkSyllable) {
        throw new Error(lt('error.generatorDep'));
    }
    const prepared = algorithm.prepareData(data);
    if (opts && opts.autoSubscript) {
        return generateWithAutoSubscript(chars, prepared, algorithm);
    }
    return generateCore(chars, prepared, algorithm);
}

/**
 * Core IME-style generation over ONE exact character sequence (no auto-expansion)
 */
function generateCore(chars, prepared, algorithm) {
    const { sequenceTemplates, charTags, combinationRules, variantMap, baseToVariant } = prepared;

    // Optional forms per input index (basic form + base variant); null if the index has no valid form
    const options = [];
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const cp = `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
        const info = charTags[cp];
        if (!info || info.tags.length === 0) { options.push(null); continue; }
        const opts = [{ ch, cp, tags: info.tags }];
        const num = parseInt(cp.slice(2), 16);
        // Add the base variant (subjoined form) so superscript syllables can be built
        if (num < 0x0F90 && info.tags.includes(2) && baseToVariant[cp]) {
            const vInfo = charTags[baseToVariant[cp]];
            if (vInfo) opts.push({ ch: vInfo.char, cp: baseToVariant[cp], tags: vInfo.tags });
        }
        // Subscript conversion (下加字): a pressed base letter can act as its OWN subjoined
        // mark — ཡ→ྱ, ར→ྲ, ལ→ླ, ཝ→ྭ — so subscripted syllables are typed from source
        // letters (e.g. མྱོ = མ ཡ ོ, NOT fabricated). Validity is gated by the "2-3" rule.
        if (num < 0x0F90 && info.tags.includes(2)) {
            const rule23 = combinationRules['2-3'];
            if (rule23) {
                for (const subList of Object.values(rule23)) {
                    for (const subCp of subList) {
                        const subNum = parseInt(subCp.slice(2), 16);
                        if (subNum >= 0x0F90 && subNum <= 0x0FB9 && subNum - 0x50 === num) {
                            const sInfo = charTags[subCp];
                            if (sInfo && sInfo.tags.includes(3)) opts.push({ ch: sInfo.char, cp: subCp, tags: sInfo.tags });
                        }
                    }
                }
            }
        }
        options.push(opts);
    }

    // text -> { text, tuple }: tuple is the input indices used (contiguous run), dedup keeps the smallest
    const units = new Map();

    function isValidPath(cps, roles) {
        const n = roles.length;
        if (n < 1 || n > 7) return false;
        // Role sequence must match a valid template
        if (!sequenceTemplates[n - 1].includes(roles.join(''))) return false;
        // Remaining rules (variant base / 0-2 / adjacent combinations) go to the authoritative implementation
        return algorithm.validateSyllablePath(cps, roles, combinationRules, variantMap);
    }

    function record(text, tuple) {
        const prev = units.get(text);
        if (!prev || tupleCmp(tuple, prev.tuple) < 0) {
            units.set(text, { text, tuple: tuple.slice() });
        }
    }

    // ---------- Stage 1: enumerate "form choices + role sequences" over contiguous runs [s..e] ----------
    const n = chars.length;
    let explored = 0;      // explored-node counter, abort when it exceeds the cap
    let exploreOverflow = false;

    for (let s = 0; s < n && !exploreOverflow; s++) {
        if (!options[s]) continue;
        for (let e = s; e < n && !exploreOverflow; e++) {
            if (!options[e]) break; // invalid char inside the run -> longer runs are invalid too
            const seq = []; // chosen form per index of the current run (keeps input order)

            // Enumerate the form chosen at each index (basic / variant)
            (function pick(idx) {
                if (exploreOverflow) return;
                if (idx > e) {
                    // Enumerate strictly increasing role sequences and validate
                    const cps = seq.map(o => o.cp);
                    const tagSets = seq.map(o => o.tags);
                    const roles = [];
                    (function roleRec(pos) {
                        if (exploreOverflow) return;
                        if (pos === seq.length) {
                            if (isValidPath(cps, roles)) {
                                const tuple = [];
                                for (let k = s; k <= e; k++) tuple.push(k);
                                record(seq.map(o => o.ch).join(''), tuple);
                            }
                            return;
                        }
                        for (const r of tagSets[pos]) {
                            if (pos > 0 && r <= roles[pos - 1]) continue;
                            if (++explored > MAX_EXPLORE) { exploreOverflow = true; return; }
                            roles.push(r);
                            roleRec(pos + 1);
                            roles.pop();
                        }
                    })(0);
                    return;
                }
                for (const opt of options[idx]) {
                    if (++explored > MAX_EXPLORE) { exploreOverflow = true; return; }
                    seq.push(opt);
                    pick(idx + 1);
                    seq.pop();
                }
            })(s);
        }
    }

    // ---------- Stage 2: particle attachment (immediately after the core run, keeping contiguity) ----------
    function isValidUnit(text) {
        return algorithm.checkSyllable(text, charTags, sequenceTemplates, combinationRules, variantMap);
    }

    /**
     * Append a particle at the end of unit (input order: particle chars must directly follow the core run):
     *   Full form: e+1 is འ, e+2 is the mark (e.g. དག + འི);
     *   Merged form: e+1 is the mark only, and the core ends with འ (e.g. མཁའ + ི).
     * Recurses to build particle chains (e.g. བདེའམའང = བདེ + འམ + འང).
     */
    function extendWithParticles(unit) {
        const e = unit.tuple[unit.tuple.length - 1];

        // Full form: འ + mark immediately after the core
        if (e + 2 < n && options[e + 1] && options[e + 2] &&
            chars[e + 1] === A_CHUNG && PARTICLE_MARKS.includes(chars[e + 2])) {
            const text = unit.text + chars[e + 1] + chars[e + 2];
            const tuple = [...unit.tuple, e + 1, e + 2];
            if (isValidUnit(text)) {
                record(text, tuple);
                extendWithParticles({ text, tuple });
            }
        }

        // Merged form: core ends with འ, mark directly follows
        if (unit.text.endsWith(A_CHUNG) && e + 1 < n && options[e + 1] &&
            PARTICLE_MARKS.includes(chars[e + 1])) {
            const text = unit.text + chars[e + 1];
            const tuple = [...unit.tuple, e + 1];
            if (isValidUnit(text)) {
                record(text, tuple);
                extendWithParticles({ text, tuple });
            }
        }
    }
    for (const unit of Array.from(units.values())) {
        extendWithParticles(unit);
    }

    // ---------- Stage 3: multi-syllable words (adjacent runs joined by ་) ----------
    const singles = Array.from(units.values()).sort((a, b) => tupleCmp(a.tuple, b.tuple));

    const all = singles.map(u => ({ text: u.text, tuple: u.tuple, group: 1 }));
    const blockStart = u => u.tuple[0];
    const blockEnd = u => u.tuple[u.tuple.length - 1];

    let overflow = false;
    outer: for (const a of singles) {
        for (const b of singles) {
            if (blockStart(b) !== blockEnd(a) + 1) continue; // must be adjacent (contiguous)
            all.push({
                text: a.text + '་' + b.text,
                tuple: [...a.tuple, ...b.tuple],
                group: 2
            });
            if (all.length >= COMPOSE_BUDGET) { overflow = true; break outer; }
            for (const c of singles) {
                if (blockStart(c) !== blockEnd(b) + 1) continue;
                all.push({
                    text: a.text + '་' + b.text + '་' + c.text,
                    tuple: [...a.tuple, ...b.tuple, ...c.tuple],
                    group: 3
                });
                if (all.length >= COMPOSE_BUDGET) { overflow = true; break outer; }
            }
        }
    }

    // Sort: group (single -> double -> triple) -> run start -> run end (input order)
    all.sort((x, y) => x.group - y.group || tupleCmp(x.tuple, y.tuple));

    const result = [];
    for (const item of all) {
        result.push(item.text);
        if (result.length >= MAX_RESULTS) break;
    }
    result.truncated = overflow || exploreOverflow || result.length < all.length;
    return result;
}

// ---------- Auto-subscript expansion (下加字 conversion mechanism) ----------
// On the nine-grid the user can only press BASE letters — variant characters (ྲ ྱ ླ ྭ and
// the subjoined bases) are not reachable. So for each base-capable input char we optionally
// insert ONE allowed subscript right after it (per the "2-3" combination rule, which lists
// the subscripts each base permits — exactly the data the rule set already carries), then
// generate every such variant and merge. Tibetan syllables allow at most one subscript, so
// one insertion per syllable is always sufficient.
const AUTO_SUB_MAX_VARIANTS = 64; // per-call cap (bases ≤ ~5 × subscripts ≤ 4 → ≤ ~17 typical)

/** Uppercase "U+XXXX" codepoint string of a visible char */
function toCp(ch) {
    return 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
}

/** Subjoined variants (U+0F90–U+0FB9) map back to their base letter */
function subscriptKeyCp(cp) {
    const num = parseInt(cp.slice(2), 16);
    return (num >= 0x0F90 && num <= 0x0FB9) ? 'U+' + (num - 0x50).toString(16).toUpperCase().padStart(4, '0') : cp;
}

/**
 * Build subscript-insertion variants of an exact character sequence:
 * the original sequence plus, for each base-capable position, one variant with each
 * allowed subscript (2-3 rule) inserted right after it.
 */
function buildSubscriptVariants(chars, charTags, combinationRules) {
    const variants = [chars.slice()];
    const rule23 = (combinationRules && combinationRules['2-3']) || {};
    for (let i = 0; i < chars.length; i++) {
        const cp = toCp(chars[i]);
        const info = charTags[cp];
        if (!info || !info.tags.includes(2)) continue;
        // Skip the virtual insertion when the NEXT pressed char is a vowel: base+vowel is
        // already a complete syllable (པོ), and པྱོ-style forms must be typed explicitly
        // (པ ཡ ོ) — a virtual subscript would fabricate a character the user never pressed.
        if (i + 1 < chars.length) {
            const nextInfo = charTags[toCp(chars[i + 1])];
            if (nextInfo && nextInfo.tags.includes(4)) continue;
        }
        const allowed = rule23[subscriptKeyCp(cp)];
        if (!allowed) continue;
        for (const subCp of allowed) {
            const subInfo = charTags[subCp];
            if (!subInfo || subInfo.tags.includes(2)) continue; // role-2 subjoined bases are NOT subscripts
            variants.push(chars.slice(0, i + 1).concat([subInfo.char], chars.slice(i + 1)));
            if (variants.length >= AUTO_SUB_MAX_VARIANTS) return variants;
        }
    }
    return variants;
}

/**
 * Auto-subscript wrapper: generate over every subscript variant and merge (dedup).
 * Plain results (no inserted subscript) come first, stacked results after.
 */
function generateWithAutoSubscript(chars, prepared, algorithm) {
    const { charTags, combinationRules } = prepared;
    const variants = buildSubscriptVariants(chars, charTags, combinationRules);
    const seen = new Set();
    const out = [];
    let truncated = false;
    for (const variant of variants) {
        const res = generateCore(variant, prepared, algorithm);
        if (res.truncated) truncated = true;
        for (const s of res) {
            if (!seen.has(s)) { seen.add(s); out.push(s); }
            if (out.length >= MAX_RESULTS) { truncated = true; break; }
        }
        if (out.length >= MAX_RESULTS) break;
    }
    out.truncated = truncated;
    return out;
}

// Export for external use
if (typeof module !== 'undefined' && module.exports) {
    // Node.js
    module.exports = {
        generateSyllablesFromChars
    };
} else {
    // Browser
    window.TibetanGenerator = {
        generateSyllablesFromChars
    };
}

})();
