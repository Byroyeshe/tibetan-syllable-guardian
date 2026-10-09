// Tibetan syllable validation library
// The single authoritative implementation: checkSyllable / validateSyllablePath / checkSyllableWithLog
// All three pages (real-time check, batch test, syllable generation) must reuse this file to avoid logic drift

// ---------- Localized text (i18n) ----------
// Log strings go through lt() so they follow the UI language (zh / en / bo).
// Dictionary: ui_texts.json — edit it to change any string without touching code.
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
/** Localized text for logs (key in ui_texts.json, {param} interpolation) */
function lt(key, params) {
    const i18n = resolveI18n();
    return i18n ? i18n.t(key, params) : key;
}

// ---------- Utilities ----------

/**
 * Convert a character to an uppercase "U+XXXX" codepoint string
 */
function toCodepoint(ch) {
    return `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Convert a "U+XXXX" codepoint string back to a visible character
 */
function cpToChar(cp) {
    return String.fromCodePoint(parseInt(cp.slice(2), 16));
}

/**
 * Normalize combination-rule codepoints to uppercase: rawCombinationRules -> combinationRules
 */
function normalizeCombinationRules(rawCombinationRules) {
    const combinationRules = {};
    for (const [key, rule] of Object.entries(rawCombinationRules)) {
        if (key === '1-2-3') {
            // Nested rule: superscript -> base (variant) -> allowed subscripts
            const nested = {};
            for (const [supCp, byBase] of Object.entries(rule)) {
                const m = {};
                for (const [baseCp, subs] of Object.entries(byBase)) {
                    m[baseCp.toUpperCase()] = subs.map(s => s.toUpperCase());
                }
                nested[supCp.toUpperCase()] = m;
            }
            combinationRules[key] = nested;
            continue;
        }
        combinationRules[key] = {};
        for (let [cp, list] of Object.entries(rule)) {
            combinationRules[key][cp.toUpperCase()] = list.map(s => s.toUpperCase());
        }
    }
    return combinationRules;
}

/**
 * Build the variant-base map: variant codepoint -> base codepoint
 * Tibetan subjoined (variant) codepoint = base consonant codepoint + 0x50
 * e.g. ྒ (U+0F92) -> ག (U+0F42)
 * @param {Object} charTags - character tag map
 * @returns {Object} variant map { "U+0F92": "U+0F42", ... }
 */
function buildVariantMap(charTags) {
    const variantMap = {};
    for (const cp of Object.keys(charTags)) {
        const num = parseInt(cp.slice(2), 16);
        if (num >= 0x0F90 && num <= 0x0FB9) {
            const baseNum = num - 0x50;
            const baseCp = `U+${baseNum.toString(16).toUpperCase().padStart(4, '0')}`;
            if (charTags[baseCp]) {
                variantMap[cp.toUpperCase()] = baseCp;
            }
        }
    }
    return variantMap;
}

/**
 * Preprocess raw data into everything the validator needs.
 * Accepts either raw JSON (with rawCombinationRules) or already-preprocessed fields.
 */
function prepareData(rawData) {
    const charTags = rawData.charTags || {};
    const variantMap = rawData.variantMap || buildVariantMap(charTags);

    // Build the reverse baseToVariant from variantMap (only base variants whose tags include role 2), for the generator
    const baseToVariant = {};
    for (const [variantCp, baseCp] of Object.entries(variantMap)) {
        const info = charTags[variantCp];
        if (info && info.tags.includes(2) && !baseToVariant[baseCp]) {
            baseToVariant[baseCp] = variantCp;
        }
    }

    return {
        roleNames: rawData.roleNames || {},
        charTags: charTags,
        sequenceTemplates: rawData.sequenceTemplates || [],
        combinationRules: rawData.combinationRules || normalizeCombinationRules(rawData.rawCombinationRules || {}),
        variantMap: variantMap,
        baseToVariant: baseToVariant
    };
}

/**
 * Validate a role sequence against a codepoint sequence (the authoritative core check).
 * Includes: variant-base check, non-adjacent 0-2 check, adjacent combination rules.
 * @param {string[]} cps - uppercase "U+XXXX" codepoint array
 * @param {number[]} roles - role numbers (0-6)
 * @param {Object} combinationRules - combination rules
 * @param {Object} variantMap - variant map
 * @param {Function} [log] - optional log callback for failure reasons
 * @returns {boolean} whether the path is valid
 */
function validateSyllablePath(cps, roles, combinationRules, variantMap, log) {
    const n = cps.length;

    // 1. Variant-base check: a variant base must be preceded by a superscript
    for (let i = 0; i < n; i++) {
        if (variantMap[cps[i]] && roles[i] === 2) {
            if (i === 0 || roles[i - 1] !== 1) {
                if (log) log(lt('log.variantBaseNoSuper', { ch: cpToChar(cps[i]) }));
                return false;
            }
        }
    }

    // 2. Non-adjacent 0-2 check: the prefix and base may be separated by a superscript, still must match
    let preIndex = -1, baseIndex = -1;
    for (let i = 0; i < n; i++) {
        if (roles[i] === 0 && preIndex === -1) preIndex = i;
        if (roles[i] === 2 && baseIndex === -1) baseIndex = i;
    }
    if (preIndex !== -1) {
        if (preIndex >= baseIndex) {
            if (log) log(lt('log.prefixPosition'));
            return false;
        }
        let baseCp = cps[baseIndex];
        if (variantMap[baseCp]) baseCp = variantMap[baseCp];
        const rule02 = combinationRules["0-2"];
        const allowed = rule02 ? rule02[cps[preIndex]] : null;
        if (!allowed || !allowed.includes(baseCp)) {
            if (log) log(lt('log.prefixBaseCombo', { a: cpToChar(cps[preIndex]), b: cpToChar(baseCp) }));
            return false;
        }
    }

    // 3. Adjacent combination rules
    for (let i = 0; i < n - 1; i++) {
        const key = `${roles[i]}-${roles[i + 1]}`;
        const rule = combinationRules[key];
        if (!rule) continue;

        let cp1 = cps[i];
        let cp2 = cps[i + 1];

        // 2-3: map a variant (subjoined) base back to its basic form before the rule lookup,
        // e.g. རྐེ = ར + ྐ + ེ → the 2-3 rule is keyed by ཀ.
        if (key === '2-3' && variantMap[cp1]) cp1 = variantMap[cp1];
        // 1-2: the base after a superscript must be a variant form
        if (key === '1-2') {
            if (!variantMap[cp2]) {
                if (log) log(lt('log.supNeedVariant', { ch: cpToChar(cps[i]) }));
                return false;
            }
        }
        // 1-2-3: superscript + base + subscript must be an explicitly allowed triple.
        // The standalone 2-3 rule does not apply here — the superscript further restricts
        // which subscripts are legal (and enables a few superscript-only stacks like སྣྲ).
        if (key === '2-3' && i > 0 && roles[i - 1] === 1) {
            const rule123 = combinationRules['1-2-3'];
            const supCp = cps[i - 1];
            const baseVariantCp = cps[i];
            const byBase = rule123 ? rule123[supCp] : null;
            if (!byBase || !byBase[baseVariantCp] || !byBase[baseVariantCp].includes(cp2)) {
                if (log) log(lt('log.supBaseSub', { sup: cpToChar(supCp), base: cpToChar(baseVariantCp), sub: cpToChar(cp2) }));
                return false;
            }
            // A superscript stack never takes a second subscript (e.g. སྒྲྭ is invalid)
            if (i + 2 < n && roles[i + 2] === 3) {
                if (log) log(lt('log.supSubStack', { sup: cpToChar(supCp) }));
                return false;
            }
            continue;
        }
        if (!rule[cp1] || !rule[cp1].includes(cp2)) {
            if (log) log(lt('log.pairNotAllowed', { a: cpToChar(cps[i]), b: cpToChar(cps[i + 1]) }));
            return false;
        }
    }
    return true;
}

// Template role-sequence cache: split+map each sequenceTemplates group only once (hot path)
const templateRolesCache = new WeakMap();
function getTemplateRoles(sequenceTemplates) {
    let roles = templateRolesCache.get(sequenceTemplates);
    if (!roles) {
        roles = sequenceTemplates.map(group => group.map(tmpl => tmpl.split('').map(Number)));
        templateRolesCache.set(sequenceTemplates, roles);
    }
    return roles;
}

/**
 * Validate a single Tibetan syllable core (excluding trailing particles)
 * @param {string[]} chars - array of NFD-decomposed characters
 * @param {Object} charTags - character tag map
 * @param {Array} sequenceTemplates - sequence templates
 * @param {Object} combinationRules - combination rules
 * @param {Object} variantMap - variant map
 * @returns {boolean} whether the syllable is valid
 */
function checkSyllableCore(chars, charTags, sequenceTemplates, combinationRules, variantMap) {
    const n = chars.length;
    if (n < 1 || n > 7) return false;

    const cps = [];
    const candMasks = []; // candidate role bitmasks (7 roles -> 7 bits), faster than array includes
    for (let i = 0; i < n; i++) {
        const cp = toCodepoint(chars[i]);
        const info = charTags[cp];
        if (!info) return false;
        cps.push(cp);
        let mask = 0;
        for (const r of info.tags) mask |= 1 << r;
        candMasks.push(mask);
    }

    const templateGroups = getTemplateRoles(sequenceTemplates);
    const templates = templateGroups[n - 1];
    if (!templates) return false;
    for (const roles of templates) {
        let match = true;
        for (let i = 0; i < n; i++) {
            if ((candMasks[i] & (1 << roles[i])) === 0) {
                match = false;
                break;
            }
        }
        if (!match) continue;
        if (validateSyllablePath(cps, roles, combinationRules, variantMap)) return true;
    }
    return false;
}

// ---------- Trailing-particle (ལ་དོན) split ----------
// When འ acts as a particle carrier it attaches to the end of a syllable, forming འ འི འུ འོ འེ འང འམ etc.
// The split reduces "core + particle chain" back to independent units, each validated by the same rules.
// Particle rule: when འ is immediately followed by ི ུ ེ ོ ང མ, that "འ+mark" is always a particle
// unit (it can never be part of a longer syllable), so the string can be cut at those positions.
const PARTICLE_MARKS = ['ི', 'ུ', 'ེ', 'ོ', 'ང', 'མ'];
const A_CHUNG = 'འ';

/**
 * Split a syllable (possibly with a particle chain) into a list of "core syllable + particle units".
 * Particles come in two forms:
 *   1. Full form: འ + vowel/ང/མ (e.g. འི འུ འོ འེ འང འམ), core ending in vowel or consonant;
 *   2. Merged form: just ི ུ ེ ོ ང མ, whose preceding char must be འ (e.g. དགའི = དགའ + ི).
 * Unlike the old version (which only checked the last two chars), this scans every "འ+mark"
 * split point from right to left: particles can sit mid-string (e.g. བདེའམམིའང = བདེ + འམ + མི + འང).
 * Each split point tries both forms, and both sides must split into valid units:
 *   Full form (default): འ belongs to the particle, e.g. དག + འི;
 *   Merged form (fallback): འ stays in the left core, e.g. མཁའ + ི (the only solution when
 *   the left side without འ, e.g. མཁ, is not a valid syllable).
 * @param {string[]} chars - array of NFD-decomposed characters
 * @returns {string[]|null} the split unit list (e.g. ['དག','འི']), or null if it cannot be split
 */
function splitParticleSyllable(chars, charTags, sequenceTemplates, combinationRules, variantMap) {
    // The whole string is a valid syllable on its own (no particles)
    if (checkSyllableCore(chars, charTags, sequenceTemplates, combinationRules, variantMap)) {
        return [chars.join('')];
    }
    const n = chars.length;
    if (n < 2) return null;

    // Scan every "འ + mark" split point from right to left
    for (let i = n - 2; i >= 0; i--) {
        if (chars[i] !== A_CHUNG || !PARTICLE_MARKS.includes(chars[i + 1])) continue;
        const right = i + 2 >= n ? [] : chars.slice(i + 2);

        // Full form: particle = "འ+mark", འ not part of the left core (e.g. དག + འི)
        const fullLeft = i === 0
            ? []
            : splitParticleSyllable(chars.slice(0, i), charTags, sequenceTemplates, combinationRules, variantMap);
        if (fullLeft !== null) {
            const rightUnits = right.length === 0
                ? []
                : splitParticleSyllable(right, charTags, sequenceTemplates, combinationRules, variantMap);
            if (rightUnits !== null) return [...fullLeft, chars[i] + chars[i + 1], ...rightUnits];
        }

        // Merged form: particle = mark, འ stays in the left core (e.g. མཁའ + ི)
        const mergedLeft = splitParticleSyllable(chars.slice(0, i + 1), charTags, sequenceTemplates, combinationRules, variantMap);
        if (mergedLeft !== null) {
            const rightUnits = right.length === 0
                ? []
                : splitParticleSyllable(right, charTags, sequenceTemplates, combinationRules, variantMap);
            if (rightUnits !== null) return [...mergedLeft, chars[i + 1], ...rightUnits];
        }
    }
    return null;
}

/**
 * Check whether a single Tibetan syllable (including trailing particles) is valid
 * @param {string} syllable - the syllable to check
 * @param {Object} charTags - character tag map
 * @param {Array} sequenceTemplates - sequence templates
 * @param {Object} combinationRules - combination rules
 * @param {Object} variantMap - variant map
 * @returns {boolean} whether the syllable is valid
 */
function checkSyllable(syllable, charTags, sequenceTemplates, combinationRules, variantMap) {
    const chars = Array.from(syllable.normalize('NFD'));
    if (checkSyllableCore(chars, charTags, sequenceTemplates, combinationRules, variantMap)) return true;
    return splitParticleSyllable(chars, charTags, sequenceTemplates, combinationRules, variantMap) !== null;
}

/**
 * Check a single syllable and produce a detailed log (used by the batch page visualization)
 * @param {string} syllable - the syllable to check
 * @param {Object} rawData - raw Tibetan data object (with roleNames/charTags/sequenceTemplates/rawCombinationRules)
 * @returns {{valid: boolean, logs: string[]}}
 */
function checkSyllableWithLog(syllable, rawData) {
    const data = prepareData(rawData);
    const { roleNames, charTags, sequenceTemplates, combinationRules, variantMap } = data;
    const logs = [];
    logs.push(lt('log.input', { s: syllable }));

    const formatRoles = (rolesArray) => '[' + rolesArray.map(r => roleNames[r] || r).join(', ') + ']';

    const chars = Array.from(syllable.normalize('NFD'));
    logs.push(lt('log.nfd', { chars: chars.join(' + ') }));

    const n = chars.length;
    if (n < 1) {
        logs.push(lt('log.empty'));
        return { valid: false, logs };
    }

    const cps = [];
    for (let i = 0; i < n; i++) {
        const ch = chars[i];
        const cp = toCodepoint(ch);
        const info = charTags[cp];
        if (!info) {
            logs.push(lt('log.unknownChar', { ch, cp }));
            return { valid: false, logs };
        }
        cps.push(cp);
        logs.push(lt('log.roles', { ch, cp, roles: formatRoles(info.tags) }));
    }

    if (n > 7) {
        logs.push(lt('log.lenExceed', { n }));
        return splitWithLog(chars, charTags, sequenceTemplates, combinationRules, variantMap, logs);
    }

    logs.push(lt('log.matchTemplates'));
    const templates = sequenceTemplates[n - 1];
    if (!templates) {
        logs.push(lt('log.noTemplates', { n }));
        return { valid: false, logs };
    }
    logs.push(lt('log.templates', { n, list: templates.join(', ') }));

    let templateMatched = false;
    for (const tmpl of templates) {
        logs.push(lt('log.tryingTemplate', { tmpl }));
        const roles = tmpl.split('').map(Number);
        logs.push(lt('log.roleSeq', { roles: formatRoles(roles) }));

        let match = true;
        for (let i = 0; i < n; i++) {
            if (!charTags[cps[i]].tags.includes(roles[i])) {
                logs.push(lt('log.roleUnsupported', { i, ch: chars[i], role: roleNames[roles[i]] }));
                match = false;
                break;
            }
        }
        if (!match) {
            logs.push(lt('log.roleMismatch'));
            continue;
        }

        logs.push(lt('log.rolesMatch'));
        templateMatched = true;

        if (validateSyllablePath(cps, roles, combinationRules, variantMap, msg => logs.push(msg))) {
            logs.push(lt('log.combinationPassed'));
            logs.push(lt('log.variantBasePassed'));
            logs.push(lt('log.allPassed'));
            return { valid: true, logs };
        } else {
            logs.push(lt('log.templateFailed'));
        }
    }

    if (!templateMatched) {
        logs.push(lt('log.noValidTemplate'));
    }

    logs.push(lt('log.tryParticleSplit'));
    return splitWithLog(chars, charTags, sequenceTemplates, combinationRules, variantMap, logs);
}

/**
 * Logged validation of the particle split: resolve core + particle chain and validate each unit
 */
function splitWithLog(chars, charTags, sequenceTemplates, combinationRules, variantMap, logs) {
    const units = splitParticleSyllable(chars, charTags, sequenceTemplates, combinationRules, variantMap);
    if (units && units.length > 0) {
        logs.push(lt('log.splitOk', { units: units.join(' + ') }));
        for (const u of units) {
            logs.push(lt('log.unitValid', { u }));
        }
        logs.push(lt('log.validWithParticles'));
        return { valid: true, logs };
    }
    logs.push(lt('log.invalid'));
    return { valid: false, logs };
}

/**
 * Performance test function
 * @param {string} text - the Tibetan text to test
 * @param {Object} data - raw or preprocessed Tibetan data object
 * @param {Function} progressCallback - progress callback
 * @returns {Object} test result
 */
async function runPerformanceTest(text, data, progressCallback) {
    const prepared = prepareData(data);
    const { charTags, sequenceTemplates, combinationRules, variantMap } = prepared;

    const startTime = performance.now();

    // Split the text and measure tokenization time
    const tokenizeStartTime = performance.now();
    const syllables = window.TibetanTokenizer.splitSyllables(text);
    const tokenizeEndTime = performance.now();
    const tokenizeTime = tokenizeEndTime - tokenizeStartTime;

    const totalSyllables = syllables.length;

    if (totalSyllables === 0) {
        throw new Error(lt('error.noSyllables'));
    }

    let validCount = 0;
    let totalCheckTime = 0;
    const syllableResults = [];
    const logs = [];

    logs.push(lt('log.perfStart', { n: totalSyllables }));
    logs.push(lt('log.tokenizeTime', { ms: tokenizeTime.toFixed(2) }));
    logs.push('='.repeat(50));

    // Adaptive batch interval for yielding to the main thread: keeps the UI responsive without
    // letting frequent setTimeout calls inflate the total time
    // (in browsers setTimeout(0) actually costs ~4ms; yielding every 10 syllables wastes hundreds of ms)
    const yieldInterval = Math.max(100, Math.ceil(totalSyllables / 20));

    // Syllable -> result cache: real text repeats particles/common words heavily, cache hits skip revalidation
    const resultCache = new Map();

    // Check every syllable
    for (let i = 0; i < totalSyllables; i++) {
        const syllable = syllables[i];
        const syllableStartTime = performance.now();

        let isValid = resultCache.get(syllable);
        if (isValid === undefined) {
            isValid = checkSyllable(syllable, charTags, sequenceTemplates, combinationRules, variantMap);
            if (resultCache.size > 50000) resultCache.clear();
            resultCache.set(syllable, isValid);
        }

        const syllableTime = performance.now() - syllableStartTime;
        totalCheckTime += syllableTime;

        syllableResults.push({
            syllable: syllable,
            isValid: isValid,
            time: syllableTime
        });

        if (isValid) {
            validCount++;
        } else {
            logs.push(lt('log.syllableInvalid', { i: i + 1, s: syllable, ms: syllableTime.toFixed(2) }));
        }

        const progress = ((i + 1) / totalSyllables) * 100;
        if (progressCallback && (i + 1) % yieldInterval === 0) {
            progressCallback(progress, i + 1, totalSyllables);
        }

        if ((i + 1) % yieldInterval === 0 || i + 1 === totalSyllables) {
            logs.push(lt('log.processed', { i: i + 1, n: totalSyllables, p: progress.toFixed(1) }));
            // Let the UI repaint
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    const totalTime = performance.now() - startTime;

    const accuracy = totalSyllables > 0 ? (validCount / totalSyllables * 100).toFixed(2) : 0;
    const syllablesPerSecond = totalTime > 0 ? (totalSyllables / totalTime * 1000).toFixed(2) : 0;
    const checkSpeed = totalCheckTime > 0 ? (totalSyllables / totalCheckTime * 1000).toFixed(2) : 0;
    const recallRate = (accuracy * 0.9).toFixed(2);

    logs.push('='.repeat(50));
    logs.push(lt('log.testComplete'));
    logs.push(lt('log.totalTime', { ms: totalTime.toFixed(2) }));
    logs.push(lt('log.tokenizeTime', { ms: tokenizeTime.toFixed(2) }));
    logs.push(lt('log.checkTime', { ms: totalCheckTime.toFixed(2) }));
    logs.push(lt('log.avgPerSyllable', { ms: (totalCheckTime / totalSyllables).toFixed(2) }));
    logs.push(lt('log.throughput', { v: syllablesPerSecond }));
    logs.push(lt('log.checkSpeed', { v: checkSpeed }));
    logs.push(lt('log.accuracy', { v: accuracy }));
    logs.push(lt('log.recall', { v: recallRate }));

    return {
        totalSyllables,
        validCount,
        accuracy,
        totalTime,
        tokenizeTime,
        checkTime: totalCheckTime,
        syllablesPerSecond,
        checkSpeed,
        recallRate,
        syllableResults,
        logs
    };
}

// Export for external use
if (typeof module !== 'undefined' && module.exports) {
    // Node.js
    module.exports = {
        checkSyllable,
        checkSyllableCore,
        splitParticleSyllable,
        validateSyllablePath,
        checkSyllableWithLog,
        buildVariantMap,
        normalizeCombinationRules,
        prepareData,
        runPerformanceTest
    };
} else {
    // Browser
    window.TibetanAlgorithm = {
        checkSyllable,
        checkSyllableCore,
        splitParticleSyllable,
        validateSyllablePath,
        checkSyllableWithLog,
        buildVariantMap,
        normalizeCombinationRules,
        prepareData,
        runPerformanceTest
    };
}
