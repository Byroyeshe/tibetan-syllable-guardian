/**
 * test_encoder.js — encoder.js 的往返测试与质量验证
 * 运行: node test_encoder.js
 *
 * 覆盖方案 §7 的场景：纯藏文单音节、格助词、多音节短语、混合文本、
 * 梵文转写、纯外来文本、空字符串、仅标点、变体基字，
 * 另加 token 结构断言、错误处理与性能(<1ms/音节)。
 * 所有用例逐条打印 PASS/FAIL 并统计总体成功率；失败时进程退出码非 0。
 */

'use strict';

const data = require('./tibetan_data.json');
const enc = require('./encoder.js');

enc.initEncoder(data); // 显式注入数据（Node 下亦可省略，会自动加载）

// ---------- 小工具 ----------
let passCount = 0, failCount = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        passCount++;
        console.log('PASS  ' + name);
    } catch (e) {
        failCount++;
        failures.push({ name, message: String((e && e.message) || e) });
        console.log('FAIL  ' + name + '  ->  ' + (e && e.message ? e.message : e));
    }
}
function eq(a, b, msg) {
    const ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja !== jb) throw new Error((msg || 'not equal') + ` | got ${ja} | expected ${jb}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'assertion failed'); }
function throws(fn, msg) {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) throw new Error(msg || 'expected throw, but did not throw');
}
/** 往返断言：decodeTokens(encodeText(input)) 必须严格等于 input */
function rt(text) {
    const back = enc.decodeTokens(enc.encodeText(text));
    eq(back, text, 'round-trip mismatch');
}

// ---------- 1. 纯藏文单音节 ----------
check('01 单音节-仅基字 ཀ', () => {
    const slots = enc.encodeSyllable('ཀ');
    ok(Array.isArray(slots) && slots.length === 7, 'slots len');
    ok(slots.every(v => Number.isInteger(v) && v >= 0), 'slots ints');
    eq(enc.decodeFromSlots(slots), 'ཀ');
    rt('ཀ');
});
check('02 基字+元音+后加 བོད', () => {
    const roles = enc.getSyllableRoles('བོད');
    eq(roles, [2, 4, 5], 'roles of བོད');
    rt('བོད');
});
check('03 前加+基字 བཀྲ', () => {
    const slots = enc.encodeSyllable('བཀྲ');
    ok(slots, 'encodeSyllable non-null');
    ok(enc.getSyllableRoles('བཀྲ')[0] === 0, 'prefix role 0');
    rt('བཀྲ');
});
check('04 上加+基字(变体)+后加 སྐབས', () => {
    const slots = enc.encodeSyllable('སྐབས');
    ok(slots, 'encodeSyllable non-null');
    ok(slots[1] > 0 && slots[2] === 1, 'sup slot + base ཀ slot'); // ྐ 映射回 ཀ (roleChars[2] 首项)
    ok(enc.getSyllableRoles('སྐབས').length === 4, 'roles len 4');
    rt('སྐབས');
});
check('05 上加+基字+下加字 རྒྱ', () => {
    ok(enc.encodeSyllable('རྒྱ'), 'encodeSyllable non-null');
    rt('རྒྱ');
});
check('06 全构件 7 槽 བསྒྲུབས', () => {
    const slots = enc.encodeSyllable('བསྒྲུབས');
    ok(slots, 'encodeSyllable non-null');
    eq(enc.getSyllableRoles('བསྒྲུབས'), [0, 1, 2, 3, 4, 5, 6], 'all seven roles');
    ok(slots.every(v => v > 0), 'no empty slot');
    rt('བསྒྲུབས');
});
check('07 上加字独立核 དག (基+后加)', () => {
    eq(enc.getSyllableRoles('དག'), [2, 5], 'roles of དག');
    rt('དག');
});
check('08 粒子单元 འི 可独立编码', () => {
    const slots = enc.encodeSyllable('འི');
    ok(slots, 'encodeSyllable non-null');
    eq(enc.decodeFromSlots(slots), 'འི');
    rt('འི');
});
check('09 非法单音节 ཀྵ / ཧྲཱི → null', () => {
    eq(enc.encodeSyllable('ཀྵ'), null);
    eq(enc.encodeSyllable('ཧྲཱི'), null);
    eq(enc.getSyllableRoles('ཀྵ'), null);
});
check('10 非法串 མཁ / ཀཀ → null', () => {
    eq(enc.encodeSyllable('མཁ'), null);
    eq(enc.encodeSyllable('ཀཀ'), null);
    eq(enc.getSyllableRoles(''), null);
});

// ---------- 2. 格助词与多音节 ----------
check('11 格助词链 སྤྲེའུའི', () => {
    const toks = enc.encodeText('སྤྲེའུའི');
    eq(toks.map(t => t.type), ['syl', 'syl', 'syl'], '3 particle units as syl');
    rt('སྤྲེའུའི');
});
check('12 助词拆核 དགའི', () => {
    const toks = enc.encodeText('དགའི');
    eq(toks.map(t => t.type), ['syl', 'syl']);
    rt('དགའི');
});
check('13 合并式助词 མཁའི (孤立 ི 以 raw 入槽，v2 不再 foreign)', () => {
    const toks = enc.encodeText('མཁའི');
    eq(toks.map(t => t.type), ['syl', 'syl']);
    eq(toks.map(t => t.kind), ['n', 'r']); // མཁའ=native，ི=raw 残串
    rt('མཁའི');
});
check('14 多音节短语 བོད་ཀྱི་སྐད་ཡིག', () => {
    const text = 'བོད་ཀྱི་སྐད་ཡིག';
    const toks = enc.encodeText(text);
    eq(toks.length, 7, '4 syl + 3 tsheg');
    eq(toks.filter(t => t.type === 'punc').map(t => t.id), [0, 0, 0], 'all tsheg id 0');
    const sylTexts = toks.filter(t => t.type === 'syl').map(t => enc.decodeFromSlots(t.slots));
    eq(sylTexts, ['བོད', 'ཀྱི', 'སྐད', 'ཡིག']);
    rt(text);
});
check('15 助词链混排 བདེའམམིའང', () => {
    rt('བདེའམམིའང');
});
check('16 真实句子', () => {
    const text = 'བོད་ཀྱི་སྐད་ཡིག་ནི་བོད་མི་ཚོའི་སྐད་ཡིག་ཡིན།';
    rt(text);
});

// ---------- 3. 混合文本 / 外来文本 / 标点 ----------
check('17 混合:藏文+数字+英文+标点', () => {
    const text = 'བོད་2024ལོར་Hello།';
    const toks = enc.encodeText(text);
    eq(toks.map(t => t.type), ['syl', 'punc', 'foreign', 'syl', 'punc', 'foreign', 'punc']);
    eq(toks.map(t => t.type === 'punc' ? t.id : null), [null, 0, null, null, 0, null, 1]);
    eq(toks[2].str, '2024');
    eq(toks[5].str, 'Hello');
    rt(text);
});
check('18 仅标点 །་༎', () => {
    const toks = enc.encodeText('།་༎');
    eq(toks.map(t => [t.type, t.id]), [['punc', 1], ['punc', 0], ['punc', 2]]);
    rt('།་༎');
});
check('19 空格为 punc(5)', () => {
    const toks = enc.encodeText('Hello 2024');
    eq(toks.map(t => t.type), ['foreign', 'punc', 'foreign']);
    eq(toks[1].id, 5);
    rt('Hello 2024');
});
check('20 纯外来文本 (含符号/标点不映射范围)', () => {
    rt('Hello, world! 2024 …中文(中文) test');
});
check('21 梵文/转写内容以 raw 入槽（kind r），无损且无 Tibetan foreign', () => {
    const text = 'ཀྵ་ཧྲཱི';
    const toks = enc.encodeText(text);
    eq(toks.map(t => t.type), ['syl', 'punc', 'syl']);
    eq(toks.map(t => t.kind || 'p'), ['r', 'p', 'r']);
    eq(enc.decodeTokens(toks), text);
});
check('22 藏文数字 foreign 无损', () => {
    rt('༢༠༢༤');
    rt('བོད་༢༠༢༤ལོར');
});
check('23 空字符串 → []', () => {
    eq(enc.encodeText(''), []);
    eq(enc.decodeTokens([]), '');
});
check('24 换行/制表符 无损', () => {
    rt('བོད་\nཀྱི་\tདང་།');
});
check('25 多空格与连续标点 无损', () => {
    rt('བོད  ཀྱི།། ་');
});
check('26 代理对(emoji)与藏文相邻 无损', () => {
    rt('བོད𝄞ཀྱི😀');
    rt('a𝄞b');
});
check('27 超长无 tsheg 串降级 foreign 无损', () => {
    rt('བོདཀྱིསྐད');
});
check('28 全角/数字/ASCII 混合 无损', () => {
    rt('Version 2.0 (beta) — 2024-01-01');
});

// ---------- 4. 结构 / 编码细节 ----------
check('29 ཀ → slots [0,0,1,0,0,0,0]', () => {
    eq(enc.encodeSyllable('ཀ'), [0, 0, 1, 0, 0, 0, 0]);
});
check('30 decodeFromSlots 与 encodeSyllable 互逆', () => {
    for (const s of ['ཀ', 'བོད', 'སྐབས', 'བསྒྲུབས', 'དགའི' === '' ? '' : 'དག']) {
        const back = enc.decodeFromSlots(enc.encodeSyllable(s));
        eq(back, s);
    }
    // 手工构造向量
    eq(enc.decodeFromSlots([0, 0, 1, 0, 0, 0, 0]), 'ཀ');
});
check('31 变体基字解码依赖上加字槽位', () => {
    // 有上加字: 基字还原为变体 (སྐ = ས+ྐ)
    const sk = enc.decodeFromSlots([0, 3, 1, 0, 0, 0, 0]);
    eq(Array.from(sk).map(c => c.codePointAt(0).toString(16)), ['f66', 'f90'], 'ས + ྐ');
    // 无上加字: 保持基础字符
    eq(enc.decodeFromSlots([0, 0, 1, 0, 0, 0, 0]), 'ཀ');
});
check('32 标点 ID 双向往返', () => {
    eq(enc.decodePunctId(0), '་');
    eq(enc.decodePunctId(1), '།');
    eq(enc.decodePunctId(2), '༎');
    eq(enc.decodePunctId(3), '\u0F0C');
    eq(enc.decodePunctId(4), '\u0F14');
    eq(enc.decodePunctId(5), ' ');
    for (const [cp, id] of Object.entries(enc.PUNCT_BY_CP)) {
        eq(String.fromCodePoint(Number(cp)), enc.decodePunctId(id));
    }
});

// ---------- 5. 错误处理 ----------
check('33 非法入参抛出可捕获错误', () => {
    throws(() => enc.encodeText(null), 'encodeText(null)');
    throws(() => enc.encodeText(123), 'encodeText(123)');
    throws(() => enc.decodeTokens('not-array'), 'decodeTokens(string)');
    throws(() => enc.decodeFromSlots([1, 2, 3]), 'slots wrong length');
    throws(() => enc.decodeFromSlots([0, 0, 99, 0, 0, 0, 0]), 'slot out of range');
    throws(() => enc.decodeTokens([{ type: 'punc', id: 99 }]), 'unknown punct id');
    throws(() => enc.decodeTokens([{ type: 'nope' }]), 'unknown token type');
    throws(() => enc.decodeTokens([null]), 'null token');
});

// ---------- 6. 性能 ----------
check('34 性能: 单音节 encode+decode < 1ms (均值)', () => {
    const syllable = 'བསྒྲུབས'; // 全 7 槽，最复杂情形
    const N = 20000;
    const t0 = performance.now();
    let slots;
    for (let i = 0; i < N; i++) slots = enc.encodeSyllable(syllable);
    const t1 = performance.now();
    for (let i = 0; i < N; i++) enc.decodeFromSlots(slots);
    const t2 = performance.now();
    const encodeAvg = (t1 - t0) / N;
    const decodeAvg = (t2 - t1) / N;
    ok(encodeAvg < 1, `encode avg ${encodeAvg.toFixed(4)}ms`);
    ok(decodeAvg < 1, `decode avg ${decodeAvg.toFixed(4)}ms`);
    console.log('      encode avg = ' + encodeAvg.toFixed(4) + ' ms | decode avg = ' + decodeAvg.toFixed(4) + ' ms');
});
check('35 性能: 整段文本 1000+ 音节往返 < 1ms/音节', () => {
    const sentence = 'བོད་ཀྱི་སྐད་ཡིག་ནི་བོད་མི་ཚོའི་སྐད་ཡིག་ཡིན།';
    const text = sentence.repeat(90); // 约 90×8 ≈ 720 音节
    const sylEstimate = (text.match(/་/g) || []).length + (text.match(/[^་།]$/) ? 1 : 0) +
        (text.match(/[^་།]་[^་།]།$/g) ? 1 : 0);
    const t0 = performance.now();
    const toks = enc.encodeText(text);
    const t1 = performance.now();
    enc.decodeTokens(toks);
    const t2 = performance.now();
    const perSyl = (t2 - t0) / sylEstimate;
    ok(perSyl < 1, `per-syllable ${perSyl.toFixed(4)}ms`);
    console.log('      syllables ~' + sylEstimate + ' | encode ' + (t1 - t0).toFixed(1) +
        'ms | round-trip ' + (t2 - t0).toFixed(1) + 'ms | ' + perSyl.toFixed(4) + ' ms/syl');
});

// ---------- 汇总 ----------
const total = passCount + failCount;
const rate = total > 0 ? ((passCount / total) * 100).toFixed(2) : '0.00';
console.log('');
console.log('='.repeat(60));
console.log(`TOTAL: ${total}  PASS: ${passCount}  FAIL: ${failCount}  SUCCESS RATE: ${rate}%`);
if (failures.length > 0) {
    console.log('');
    console.log('Failed cases:');
    for (const f of failures) console.log('  - ' + f.name + ' :: ' + f.message);
    process.exitCode = 1;
} else {
    console.log('ALL TESTS PASSED ✔');
}
