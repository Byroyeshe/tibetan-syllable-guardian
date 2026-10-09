/**
 * test_encoder_v2.js — encoder（纯 kind n/r 版）回归
 * 运行: node test_encoder_v2.js
 *
 * 语义（见 docs/7槽全量无损编码方案.md）：校验层 native-only；
 *   kind 'n' = native 音节/截断段（roleChars 序号，逐角色入槽）；
 *   kind 'r' = raw 残串（Tibetan 全字符表，≤7 字/块）——双叠、梵文/转写内容、
 *   无法截断的残串一律 raw 承载。Tibetan 内容不再产生 foreign。
 */
'use strict';

const enc = require('./encoder.js');
const data = require('./tibetan_data.json');
enc.initEncoder(data);

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); pass++; console.log('PASS  ' + name); }
    catch (e) { fail++; console.log('FAIL  ' + name + '  ->  ' + ((e && e.message) || e)); }
}
function ok(v, msg) { if (!v) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) {
    const ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja !== jb) throw new Error((msg || 'not equal') + ` | got ${ja} | expected ${jb}`);
}
const rt = s => eq(enc.decodeTokens(enc.encodeText(s)), s, 'round-trip ' + JSON.stringify(s));

check('01 全量往返：native / 粘连截断 / raw 残串 / 混合', () => {
    for (const s of [
        'བོད', 'བསྒྲུབས', 'ཞྭ', 'གྲྭ', 'ཀྲྭ', 'ཕྱྭ', 'པཱ', 'ཀཱ', 'ཤཱཀྱ', 'པདྨ', 'མཱི', 'མཱིས', 'ཨོཾ',
        'ཀྵ', 'ཧྲཱི', 'ནྱ', 'ཀརྨ', 'དལའམབོཅུ', 'བོདཀྱིསྐདཡིགདངལྷ', 'ཐངགི', 'གླུུ', 'ཀིྲ', 'མཁའི',
        'སྤྲེའུའི', 'གྲྭ་དང་པཱ།', 'བོད་2024ལོར་Hello།', 'Version 2.0 (beta) — 2024'
    ]) rt(s);
});
check('02 Tibetan 内容一律入槽（kind ∈ {n,r} + punc），不再产生 foreign', () => {
    const text = 'གྲྭ་དང་པཱ་ཐངགི་ཤཱཀྱ། ནྱ བོད དགའི་སྤྲེའུའི';
    const bad = enc.encodeText(text).filter(t => t.type === 'foreign');
    ok(bad.length === 0, '纯 Tibetan 文本不应有 foreign token，实际 ' + bad.length);
    const kinds = enc.encodeText('གྲྭ་དང་པཱ་ཐངགི་ནྱ།').filter(t => t.type === 'syl').map(t => t.kind);
    ok(kinds.every(k => k === 'n' || k === 'r'), 'kind ∈ {n,r}：' + JSON.stringify(kinds));
    const mixed = enc.encodeText('བོད 2024ལོར་Hello།');
    const fs = mixed.filter(t => t.type === 'foreign').map(t => t.str);
    ok(fs.length >= 1 && fs.every(str => !/[\u0F40-\u0FBC]/.test(str)), 'foreign 仅非 Tibetan：' + JSON.stringify(fs));
});
check('03 双叠/梵文内容以 raw（kind r）承载且可精确还原', () => {
    for (const s of ['གྲྭ', 'པཱ', 'ཤཱཀྱ', 'མཱི', 'མཱིས', 'ཨོཾ', 'ཀྵ', 'ནྱ', 'ཧྲཱི']) {
        const toks = enc.encodeText(s);
        ok(toks.length === 1 && toks[0].kind === 'r', s + ' 应为单个 raw token，实际 ' + JSON.stringify(toks.map(t => t.kind)));
        eq(enc.decodeTokens([toks[0]]), s);
    }
});
check('04 native 截断：无 tsheg 粘连可恢复串 → 逐段 kind n', () => {
    const toks = enc.encodeText('དལའམབོཅུ');
    eq(toks.map(t => t.kind), ['n', 'n', 'n', 'n']);
    eq(toks.map(t => enc.decodeTokens([t])).join('|'), 'དལ|འམ|བོ|ཅུ');
    rt('དལའམབོཅུ');
    const long = 'བོདཀྱིསྐདཡིགདངལྷ';
    const lt = enc.encodeText(long);
    ok(lt.every(t => t.kind === 'n'), '长粘连串应全部 native 分段');
    rt(long);
    // 全 native 核惯例连写（Karmapa）→ native 分段 [ཀ][རྨ]
    const kar = enc.encodeText('ཀརྨ');
    eq(kar.map(t => t.kind), ['n', 'n']);
    eq(kar.map(t => enc.decodeTokens([t])).join('|'), 'ཀ|རྨ');
});
check('05 无法切分的残串仍按 raw 入槽', () => {
    for (const s of ['གླུུ', 'ཀིྲ']) {
        const toks = enc.encodeText(s);
        ok(toks.length === 1 && toks[0].kind === 'r', s + ' 应为单个 raw token');
    }
    rt('གླུུ');
});
check('06 旧 token（无 kind）按 native 解码（向后兼容）', () => {
    eq(enc.decodeTokens([{ type: 'syl', slots: [0, 0, 1, 0, 0, 0, 0] }]), 'ཀ');
});
check('07 encodeSyllable 语义：native-only（校验合法 ⟺ 可编码）', () => {
    ok(enc.encodeSyllable('བོད') !== null, 'native 应可直编');
    eq(enc.encodeSyllable('གྲྭ'), null, 'གྲྭ native API → null（文本级以 raw 承载）');
    eq(enc.encodeSyllable('པཱ'), null, 'པཱ native API → null（文本级以 raw 承载）');
    eq(enc.encodeSyllable('ཀིྲ'), null);
});

const total = pass + fail;
console.log('');
console.log('='.repeat(60));
console.log(`ENCODER V2 TOTAL: ${total}  PASS: ${pass}  FAIL: ${fail}`);
if (fail > 0) process.exitCode = 1;
else console.log('ALL ENCODER V2 TESTS PASSED ✔');
