/**
 * encoder.js — Tibetan syllable encoder（独立编码器，纯 kind n/r 版）
 *
 * 在已有的藏文音节校验器 (tibetan_algorithm.js / tibetan_data.json) 之上，
 * 提供有损于"结构"但无损于"文本"的 token 化：
 *
 *   encodeText(text)  ->  token 数组，token 为三种类型之一：
 *     { type:'syl', kind:'n'|'r', slots:[int×7] }
 *         kind 'n' = native 音节/截断段（角色制入槽，语义见下）
 *         kind 'r' = raw 残串（≤7 字一块，逐字按 Tibetan 全字符表入槽）
 *     { type:'punc', id:int }         常用标点 → 整数 ID（0..5）
 *     { type:'foreign', str:string }  非 Tibetan 内容（数字/拉丁/其它）→ 原样字符串（无损）
 *   decodeTokens(tokens) -> 原始文本（与 encodeText 互为逆运算）
 *
 * 槽位布局（角色顺序与藏文书写顺序一致，见 tibetan_data.json roleNames）：
 *   slots[0]=前加字  slots[1]=上加字  slots[2]=基字(必填,存基础字符)
 *   slots[3]=下加字  slots[4]=元音    slots[5]=后加字  slots[6]=再后加字
 * 槽位值 = 该字符在 roleChars[role] 中的下标 + 1；0 = 空。
 *
 * ── 归类流程（Tibetan 内容一律入槽，不再产生 Tibetan foreign）──
 *   letter-run U
 *     1) native 判定：可拆为合法单元链（含粒子）→ 每单元 kind:'n'
 *     2) 否则 native 截断：最长合法音节切分（DP，每段可 native 入槽），
 *        全串可完全覆盖 → 每段 kind:'n'（如 དལའམབོཅུ → དལ|འམ|བོ|ཅུ）
 *     3) 否则 raw：按 ≤7 字符切块 → kind:'r'（0 填充）
 *
 * ── 与方案文档的差异/设计说明 ──
 * 1. 标点 ID：固定 5 个常用标点 + 空格 (U+0020) 严格映射为 punc token；其余 U+0F00–U+0F1F
 *    字符与藏文数字等无法单整数还原，按 foreign 原样保留（无损）。
 * 2. 校验层 native-only：梵文/转写内容（ཱ/ཽ/ནྱ/པདྨ 等）校验一律判非法；
 *    编码对其走 kind 'r' 原样承载（曾有的 translit 校验层及其 layer 文件已于 2025-02-14 移除）。
 * 3. 任何"角色匹配了模板、但槽位数据不吻合"的异常情形都会让该单元降级（截断/raw），
 *    绝不产生解码后对不上原文本的 syl token（encodeSyllable 内置往返自检兜底）。
 * 4. native 层保持"校验合法 ⟺ 可 7 槽编码"双射（encodeSyllable/decodeFromSlots）；
 *    文本级 encodeText 额外覆盖：粘连串按合法音节截断（kind n）、无法解析残串按 raw（kind r）。
 *
 * 使用方式：
 *   Node:  const enc = require('./encoder.js');
 *   Browser: 先 <script> 引入 tibetan_algorithm.js 与 tibetan_data.json 数据
 *   （如 window.TibetanData），再调用 TibetanEncoder.initEncoder(data)。
 *   未显式 init 时，Node 下会自动 require('./tibetan_data.json')。
 */

(function () {
    'use strict';

    // ---------- 环境解析（惰性，与 tibetan_generator.js 同风格） ----------
    let Algorithm = null;
    function resolveAlgorithm() {
        if (!Algorithm) {
            if (typeof window !== 'undefined' && window.TibetanAlgorithm) {
                Algorithm = window.TibetanAlgorithm;
            } else if (typeof require === 'function') {
                try { Algorithm = require('./tibetan_algorithm.js'); } catch (e) { Algorithm = null; }
            }
        }
        return Algorithm;
    }

    // ---------- 数据缓存（prepareData 结果不含 roleChars，需单独读取） ----------
    let RAW_DATA = null;
    let PREPARED = null;   // { charTags, sequenceTemplates, combinationRules, variantMap, baseToVariant }
    let ROLE_CHARS = null; // 从 tibetan_data.json 直接读取的 roleChars（码点字符串数组）
    let CHARTAGS = null;
    let SEQ_TMPL = null;
    let COMB_RULES = null;
    let VARIANT_MAP = null;
    let BASE_TO_VARIANT = null;

    // ---------- 标点映射 ----------
    const PUNCT_BY_CP = {
        0x0F0B: 0, // tsheg      ་
        0x0F0D: 1, // 句号       །
        0x0F0E: 2, // 双句号     ༎
        0x0F0C: 3, // 逗号/分隔  ༌
        0x0F14: 4, // 问号       ༔
        0x0020: 5  // 空格
    };
    const PUNCT_BY_ID = {};
    for (const cp of Object.keys(PUNCT_BY_CP)) PUNCT_BY_ID[PUNCT_BY_CP[cp]] = Number(cp);

    // ---------- 小工具 ----------
    function toCp(ch) {
        return 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    }
    function cpToChar(cp) {
        return String.fromCodePoint(parseInt(cp.slice(2), 16));
    }
    /** roleChars 内的码点字符串统一大写，防止大小写不一致导致 indexOf 失败 */
    function normalizeRoleChars(rc) {
        const out = {};
        for (const role of Object.keys(rc || {})) {
            out[role] = (Array.isArray(rc[role]) ? rc[role] : []).map(s => String(s).toUpperCase());
        }
        return out;
    }

    // ---------- 初始化 ----------
    function initEncoder(rawData) {
        const alg = resolveAlgorithm();
        if (!alg || !alg.prepareData || !alg.splitParticleSyllable || !alg.validateSyllablePath) {
            throw new Error('TibetanEncoder: 依赖缺失，请先加载 tibetan_algorithm.js');
        }
        RAW_DATA = rawData || RAW_DATA;
        if (!RAW_DATA) {
            if (typeof require === 'function') {
                RAW_DATA = require('./tibetan_data.json');
            } else if (typeof window !== 'undefined' && window.TibetanData) {
                RAW_DATA = window.TibetanData;
            }
        }
        if (!RAW_DATA) {
            throw new Error('TibetanEncoder: 未找到 tibetan_data.json，请先调用 initEncoder(data)');
        }
        PREPARED = alg.prepareData(RAW_DATA);
        CHARTAGS = PREPARED.charTags;
        SEQ_TMPL = PREPARED.sequenceTemplates;
        COMB_RULES = PREPARED.combinationRules;
        VARIANT_MAP = PREPARED.variantMap;
        BASE_TO_VARIANT = PREPARED.baseToVariant;
        ROLE_CHARS = normalizeRoleChars(RAW_DATA.roleChars);
        return true;
    }
    function ensureReady() {
        if (!PREPARED) initEncoder();
    }

    // ---------- 角色序列求解（与 checkSyllableCore 同模板迭代序，返回命中角色） ----------
    function findRolesForChars(chars) {
        const n = chars.length;
        if (n < 1 || n > 7) return null;

        const cps = [];
        const candMasks = [];
        for (let i = 0; i < n; i++) {
            const cp = toCp(chars[i]);
            const info = CHARTAGS[cp];
            if (!info) return null;
            cps.push(cp);
            let mask = 0;
            for (const r of info.tags) mask |= 1 << r;
            candMasks.push(mask);
        }

        const templates = SEQ_TMPL[n - 1];
        if (!templates) return null;
        for (const tmpl of templates) {
            const roles = [];
            for (let k = 0; k < tmpl.length; k++) roles.push(Number(tmpl[k]));
            let match = true;
            for (let i = 0; i < n; i++) {
                if ((candMasks[i] & (1 << roles[i])) === 0) { match = false; break; }
            }
            if (!match) continue;
            if (validateRoles(cps, roles)) return roles;
        }
        return null;
    }
    function validateRoles(cps, roles) {
        const alg = resolveAlgorithm();
        if (alg && alg.validateSyllablePath) {
            return alg.validateSyllablePath(cps, roles, COMB_RULES, VARIANT_MAP);
        }
        return false;
    }

    // ---------- 公开 API：native 单音节编解码 ----------
    function getSyllableRoles(syllable) {
        ensureReady();
        if (typeof syllable !== 'string') return null;
        return findRolesForChars(Array.from(syllable.normalize('NFD')));
    }

    /**
     * 将单个 native 合法音节（纯核；粒子单元如 "འི" 亦可）编码为 7 槽位向量。
     * 语义：native-only（校验合法 ⟺ 可编码）。双叠字形（གྲྭ）或梵文/转写内容返回 null——
     * 文本级由 encodeText 以截断(kind n)或 raw(kind r)承载。
     */
    function encodeSyllable(syllable) {
        ensureReady();
        if (typeof syllable !== 'string') return null;
        const chars = Array.from(syllable.normalize('NFD'));
        const roles = findRolesForChars(chars);
        if (!roles) return null;

        const slots = [0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < chars.length; i++) {
            const role = roles[i];
            let cp = toCp(chars[i]);
            if (role === 2 && VARIANT_MAP[cp]) cp = VARIANT_MAP[cp];
            const arr = ROLE_CHARS[role];
            if (!arr) return null;
            const idx = arr.indexOf(cp);
            if (idx < 0) return null;
            slots[role] = idx + 1;
        }
        try {
            if (decodeFromSlots(slots) !== chars.join('')) return null;
        } catch (e) {
            return null;
        }
        return slots;
    }

    function decodeFromSlots(slots) {
        ensureReady();
        if (!Array.isArray(slots) || slots.length !== 7) {
            throw new Error('TibetanEncoder.decodeFromSlots: slots 必须是长度为 7 的数组');
        }
        let out = '';
        for (let role = 0; role < 7; role++) {
            const v = slots[role];
            if (v === 0 || v === undefined) continue;
            if (!Number.isInteger(v)) {
                throw new Error('TibetanEncoder.decodeFromSlots: 槽位值必须为整数');
            }
            const arr = ROLE_CHARS[role];
            if (!arr || v < 1 || v > arr.length) {
                throw new Error(`TibetanEncoder.decodeFromSlots: 槽位 ${role} 值 ${v} 越界 (roleChars[${role}] 长度 ${arr ? arr.length : '?'})`);
            }
            let cp = arr[v - 1];
            if (role === 2 && slots[1] > 0) {
                const variantCp = BASE_TO_VARIANT[cp];
                if (variantCp) cp = variantCp;
            }
            out += cpToChar(cp);
        }
        return out;
    }

    // ---------- kind 'r'：Tibetan 全字符表（raw 残串） ----------
    const TIB_CHARS = (function () {
        const arr = [];
        for (let cp = 0x0F40; cp <= 0x0FBC; cp++) arr.push(cp);
        return arr;
    })();
    const TIB_CHAR_IDX = new Map();
    TIB_CHARS.forEach((cp, i) => TIB_CHAR_IDX.set(String.fromCodePoint(cp), i + 1));
    function tibIdx(ch) { return TIB_CHAR_IDX.get(ch) || 0; }
    function glyphAt(ord) {
        if (!Number.isInteger(ord) || ord < 1 || ord > TIB_CHARS.length) return '';
        return String.fromCodePoint(TIB_CHARS[ord - 1]);
    }
    function rawSlots(chunkChars) {
        const slots = [0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < chunkChars.length && i < 7; i++) slots[i] = tibIdx(chunkChars[i]);
        return slots;
    }
    function rawTokens(str) {
        const out = [];
        const chs = Array.from(str);
        for (let i = 0; i < chs.length; i += 7) {
            out.push({ type: 'syl', kind: 'r', slots: rawSlots(chs.slice(i, i + 7)) });
        }
        return out;
    }
    function decodeSlotsR(slots) {
        let out = '';
        for (const v of slots) { if (v > 0) out += glyphAt(v); }
        return out;
    }

    /** syl token 解码（kind: n|r；旧/缺失 kind 按 n） */
    function decodeSylToken(tok) {
        const kind = tok.kind || 'n';
        if (kind === 'r') return decodeSlotsR(tok.slots);
        return decodeFromSlots(tok.slots); // 'n' 及历史 token
    }

    // ---------- 文本级 token 化 ----------
    function isLetterCp(cp) { return cp >= 0x0F40 && cp <= 0x0FBC; }
    function isPunctCp(cp) { return Object.prototype.hasOwnProperty.call(PUNCT_BY_CP, cp); }

    /**
     * native 最长合法音节截断：对无 tsheg 粘连串（如 དལའམབོཅུ）切分为"每段都可 native 入槽"的单元链
     * （དལ|འམ|བོ|ཅུ）。DP 自后向前、逐位取最长可编码前缀；整串无法完全覆盖返回 null（保持 raw）。
     */
    function nativeSegmentUnits(str) {
        const chars = Array.from(str);
        const n = chars.length;
        if (n < 2 || n > 64) return null;
        const maxL = Math.min(7, n);
        const reach = new Array(n + 1).fill(false);
        const cut = new Array(n + 1).fill(0);
        reach[n] = true;
        const encAt = (i, L) => encodeSyllable(chars.slice(i, i + L).join('')) !== null;
        for (let i = n - 1; i >= 0; i--) {
            for (let L = maxL; L >= 1; L--) {
                if (i + L <= n && reach[i + L] && encAt(i, L)) {
                    reach[i] = true;
                    cut[i] = L;
                    break;
                }
            }
        }
        if (!reach[0]) return null;
        const units = [];
        let i = 0;
        while (i < n) {
            const L = cut[i];
            if (!L) return null;
            units.push(chars.slice(i, i + L).join(''));
            i += L;
        }
        return units.length >= 2 ? units : null;
    }

    /** 处理一个"藏文字母串"：native 单元链 → native 截断多段 → raw 残串（一律入槽） */
    function appendLetterRun(chars, tokens) {
        const run = chars.join('');
        const alg = resolveAlgorithm();

        // 1) native：整串可拆为合法单元链（含粒子）→ 每单元 kind:'n'
        if (alg && PREPARED) {
            const nfd = Array.from(run.normalize('NFD'));
            const units = nfd.length === chars.length
                ? alg.splitParticleSyllable(nfd, CHARTAGS, SEQ_TMPL, COMB_RULES, VARIANT_MAP)
                : null;
            if (units) {
                for (const unit of units) {
                    const slots = encodeSyllable(unit);
                    if (slots) tokens.push({ type: 'syl', kind: 'n', slots });
                    else tokens.push(...tierFallback(unit));
                }
                return;
            }
        }
        tokens.push(...tierFallback(run));
    }

    /** 2) native 截断（无 tsheg 粘连可恢复串 → 逐段 kind n）；3) raw（≤7 字一块 kind r） */
    function tierFallback(str) {
        const segs = nativeSegmentUnits(str);
        if (segs) {
            const out = [];
            for (const u of segs) {
                const slots = encodeSyllable(u);
                if (slots) out.push({ type: 'syl', kind: 'n', slots });
                else out.push(...rawTokens(u)); // 理论不可达（encAt 已保证可入槽）
            }
            return out;
        }
        return rawTokens(str);
    }

    function encodeText(text) {
        if (typeof text !== 'string') {
            throw new TypeError('TibetanEncoder.encodeText: 入参必须是字符串');
        }
        ensureReady();
        const units = Array.from(text);
        const n = units.length;
        const tokens = [];
        let i = 0;
        while (i < n) {
            const cp = units[i].codePointAt(0);
            if (isLetterCp(cp)) {
                let j = i + 1;
                while (j < n && isLetterCp(units[j].codePointAt(0))) j++;
                appendLetterRun(units.slice(i, j), tokens);
                i = j;
            } else if (isPunctCp(cp)) {
                tokens.push({ type: 'punc', id: PUNCT_BY_CP[cp] });
                i++;
            } else {
                let j = i + 1;
                while (j < n) {
                    const c = units[j].codePointAt(0);
                    if (isLetterCp(c) || isPunctCp(c)) break;
                    j++;
                }
                tokens.push({ type: 'foreign', str: units.slice(i, j).join('') });
                i = j;
            }
        }
        return tokens;
    }

    function decodePunctId(id) {
        if (!Number.isInteger(id) || !Object.prototype.hasOwnProperty.call(PUNCT_BY_ID, id)) {
            throw new Error(`TibetanEncoder: 未知标点 ID: ${id}`);
        }
        return String.fromCodePoint(PUNCT_BY_ID[id]);
    }

    function decodeTokens(tokens) {
        if (!Array.isArray(tokens)) {
            throw new TypeError('TibetanEncoder.decodeTokens: 入参必须是 token 数组');
        }
        let out = '';
        for (const tok of tokens) {
            if (!tok || typeof tok !== 'object') {
                throw new Error('TibetanEncoder.decodeTokens: 非法 token');
            }
            if (tok.type === 'syl') {
                if (!Array.isArray(tok.slots) || tok.slots.length !== 7 || tok.slots.some(v => !Number.isInteger(v))) {
                    throw new Error('TibetanEncoder.decodeTokens: syl token 槽位非法');
                }
                out += decodeSylToken(tok);
            } else if (tok.type === 'punc') {
                out += decodePunctId(tok.id);
            } else if (tok.type === 'foreign') {
                out += String(tok.str);
            } else {
                throw new Error(`TibetanEncoder.decodeTokens: 未知 token 类型 '${tok.type}'`);
            }
        }
        return out;
    }

    /** 调试辅助：token 数组的可读摘要 */
    function describeTokens(tokens) {
        return tokens.map(t => {
            if (t.type === 'syl') {
                const k = t.kind || 'n';
                let txt;
                try { txt = decodeSylToken(t); } catch (e) { txt = '?'; }
                return `syl#${k}(${txt})`;
            }
            if (t.type === 'punc') return `punc(${t.id})`;
            return `foreign(${JSON.stringify(t.str)})`;
        }).join(' | ');
    }

    // ---------- 导出 ----------
    const API = {
        initEncoder,
        encodeSyllable,
        decodeFromSlots,
        getSyllableRoles,
        encodeText,
        decodeTokens,
        decodePunctId,
        describeTokens,
        PUNCT_BY_CP,
        PUNCT_BY_ID
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = API;
    } else {
        window.TibetanEncoder = API;
    }
})();
