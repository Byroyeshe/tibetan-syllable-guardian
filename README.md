# Byro Tibetan Syllable Guardian
### 藏文音节引擎 / Tibetan Syllable Engine

**A rule-based Tibetan syllable validator and structural encoder. No word list, no exception dictionary — and it tells you *which* position of the syllable is wrong.**

藏文音节引擎：**不查词表**的藏文音节校验器 + 结构编码器，判定结果可解释（哪一位、和哪一位不搭）。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Commercial license available](https://img.shields.io/badge/License-Commercial-orange.svg)](LICENSE-COMMERCIAL.md)
[![Latest release](https://img.shields.io/github/v/release/sonamzade/tibetan-syllable-guardian)](https://github.com/sonamzade/tibetan-syllable-guardian/releases)
[![Zero dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)](#performance--性能)

**Live demo:** https://note.byrocode.online/ — open and use, no sign-up (desktop Chrome / Edge)

> **Byro** is the project name; **Tibetan Syllable Guardian** (藏文音节守护者) is the engine.
> The writing application built on it lives in a separate repository.

---

## What it does / 它做什么

| | |
|---|---|
| **Validate** | Decide whether a Tibetan syllable is orthographically well-formed, and report *which position* (which of the seven components) does not fit. |
| **Decompose** | Decompose a syllable into its seven structural components (prefix / superscript / base / subscript / vowel / suffix / post-suffix) — the information downstream grammar rules need. |
| **Encode** | Encode syllable structure into a fixed-width slot representation, with a stable identity across equivalent Unicode spellings. |
| **Generate** | Generate all well-formed syllables and multi-syllable words from a candidate character set, using the same rule table as the validator. |
| **Tokenize** | Split running text into syllable units, including the trailing-particle forms (`འི / འུ / འོ / འང / འམ`). |

**Pure JavaScript, zero dependencies, zero build step.** The engine runs in Node with nothing to install; the browser test suite is a static page served by any HTTP server (it fetches its rule table, so `file://` will not work).

---

## Why not a word list / 为什么不用词表

Tibetan spelling mistakes frequently are not "a word that is misspelled". The classic case is a **missing tsheg (་)**:

```tibetan
བོད་ཀྱི་སྐད་ཡིག      ✅  four well-formed syllables
བོདཀྱི་སྐད་ཡིག       ❌  the first two syllables have fused into one
```

Both `བོད` and `ཀྱི` are perfectly good words, so a word list sees nothing wrong — the error only exists at the *syllable structure* level. Fused syllables like this are common in real manuscripts and are precisely the failure class that rule-set-based academic systems report as unsolved.

This engine therefore builds on Tibetan orthography as formal rules:

- **No word list, no exception dictionary.** Anything orthographically well-formed is accepted, including unattested names and coinages. Coverage is not limited by how many syllables someone managed to enumerate.
- **Every rejection is explainable.** The answer is not "not found" but "position 1 is a vowel slot, and `བ` cannot be a vowel".
- **Constant work per syllable.** At most 7 code points, at most a dozen templates per length — the cost does not grow with any vocabulary.

### Scope boundary: Sanskrit transliteration

Sanskrit transcription and phonetic loan spellings (`ཱ`, `ཽ`, `ནྱ`, `པདྨ`, …) are **deliberately out of scope** for validation: orthographic rules should not be bent to accommodate a different writing system. The validator rejects them by design; the encoder carries them through losslessly as raw content so that original text is never altered. In application code they are flagged, not "fixed".

---

## How it works / 怎么判定

Legality is decided by three layers of knowledge, checked coarse-to-fine:

| Layer | Content |
|---|---|
| **1. Character roles** | Which of the seven roles each Tibetan character can take. `ག` can be a prefix, a base, or a suffix; `ས` can also be a post-suffix. |
| **2. Length templates** | For each syllable length (1–7 characters), the finite set of permitted role sequences — e.g. base + vowel + suffix, prefix + base + suffix, superscript + base + subscript. |
| **3. Character-level compatibility** | Which concrete characters may co-occur in specific roles: **adjacent** pairs (base vs. subscript), **non-adjacent / cross-position** pairs (a prefix and a base with a superscript between them), and **ternary** combinations (superscript + base + subscript, which cannot be reduced to pairwise rules). |

Decision is a chain: match the role sequence against a template for that length, then verify character compatibility pair by pair.

> **Rules only say what is forbidden. Any constraint not declared is permitted.**

This principle is why the rule table does not need to be exhaustive: a new name or a modern coinage is accepted unless it violates a declared constraint.

### Two outputs from one analysis

Validating gives a yes/no. The second — equally important — output is **structure**: which component sits in which position of the syllable. This is what downstream Tibetan grammar needs:

- Choosing between the genitive forms `གི / ཀྱི / གྱི` depends not on the word but on **the last consonant written in the preceding syllable**.
- Ergative and allative fused forms require the suffix to be **stripped** from the syllable before the stem can be matched.
- Dictionary de-duplication and index lookups need an identity that is stable across equivalent Unicode spellings of the same syllable.

Doing that on raw strings means re-implementing "what was the last consonant written" and re-copying the orthographic table — a second copy that will eventually diverge from the validator's. So the engine emits a **fixed-width slot representation** alongside the verdict, and those rules become slot lookups.

**Separation of duties: the validator answers *is it right*, the slot representation answers *what is it*.**

---

## Quick start / 快速开始

### Node.js (JavaScript engine, no dependencies)

```js
const raw = require('./tibetan_data.json');
const alg = require('./tibetan_algorithm.js');
const enc = require('./encoder.js');

const P = alg.prepareData(raw);
const check = (s) => alg.checkSyllable(
  s, P.charTags, P.sequenceTemplates, P.combinationRules, P.variantMap
);

check('བོད');        // true
check('གྲྭ');        // true   (valid, although it stacks two subscripts)
check('བསྒྲུབས');    // true
check('དགའི');       // true   (valid as དག + particle འི)
check('བོདཀྱི');     // false  (missing tsheg — two syllables fused)
check('བབབ');        // false  (prefix བ + base བ + suffix བ is not well-formed)
check('པཱ');         // false  (Sanskrit transliteration — out of scope by design)

alg.splitParticleSyllable(Array.from('དགའི'.normalize('NFD')),
  P.charTags, P.sequenceTemplates, P.combinationRules, P.variantMap);
// => [ 'དག', 'འི' ]   (full form: འ belongs to the particle — the left side དག is a syllable on its own)
//    [ 'མཁའ', 'ི' ]   (merged form: མཁ alone is not a syllable, so འ stays in the core)
//    [ 'བདེ', 'འམ', 'མི', 'འང' ]   (particle chains can sit mid-string)

// Structure, not just a verdict:
alg.checkSyllableWithLog('བབབ', raw).logs;
// valid = false, with reasons such as:
// "❌ Position 1 char བ does not support role Vowel — skip"

// Structural encoding:
enc.initEncoder(raw);
enc.getSyllableRoles('ཀྱི');    // [2, 3, 4] = base, subscript, vowel
enc.encodeSyllable('བོད');      // [0, 0, 15, 0, 4, 3, 0]  (one slot per component; 0 = empty)
enc.decodeFromSlots([0, 0, 15, 0, 4, 3, 0]);   // => 'བོད'
```

### Generate syllables and words

```js
const gen = require('./tibetan_generator.js');
gen.generateSyllablesFromChars(['ཀ', 'ར', 'ལ', 'ས'], raw);
// 32 results, from single syllables to multi-syllable words:
// ཀ ཀར ཀྲ ཀྲལ ར རལ རླ རླས ལ ལས ས ཀ་ར ཀ་རལ … ཀར་ལ་ས
```

The generator consumes the **same** rule table as the validator, so a generated syllable cannot be one the validator rejects.

### Full-text round trip (lossless)

```js
enc.initEncoder(raw);
const text = 'བོད་ཀྱི་སྐད་ཡིག 123 abc པཱ';
const tokens = enc.encodeText(text);
enc.decodeTokens(tokens) === text;   // true — decode ∘ encode ≡ identity
```

Tibetan content is carried either as native structure or as raw content; non-Tibetan content (digits, Latin, punctuation) is kept separately. Nothing is normalized away or dropped.

---

## Performance / 性能

| Property | Value |
|---|---|
| Work per syllable | Bounded by a constant: ≤ 7 code points × a dozen templates × a few compatibility checks |
| Single-syllable validation latency | **microseconds** |
| Measured throughput — no memoization (Node 25.2.1, one machine) | 178.6 ms for 100,008 syllables ≈ **0.56 M syllables/s**; repeated runs ranged 175–205 ms |
| Same corpus with syllable-level memoization (12 distinct syllables) | **6.1 ms** (runs 6.1–7.2 ms) — about **26× faster** |
| Runtime dependencies | **none** — Unicode normalization uses the built-in `String.prototype.normalize('NFD')`; no third-party libraries |
| Source size | 7 modules, ~1,900 lines of JavaScript + a 7.5 KB rule table, no build step |

The benchmark measures in-process **pure validation** (no tokenization, no I/O) over a deliberately repetitive 12-syllable corpus, so it is both an approximation of real text (where repetition is around 95%) and a worst case in which per-call JavaScript overhead is paid 100,000 times. The rule table's complexity is bounded and independent of vocabulary size.

Throughput is a property of the *rules*, not of a vocabulary — the engine does not grow when more words are added, because there is no word list to grow.

---

## Evidence: validated against real corpora / 语料验证

Rules are written by humans, and humans make mistakes. The rule table is therefore tested against real text:

| Corpus | Size | Well-formed rate |
|---|---|---|
| Degé Kangyur, Vinaya section (13 volumes) | 3.14 M syllable units | **99.58%** |
| Modern encyclopedic Tibetan | 87 K syllable units | **99.03%** |

Breakdown of the residual 0.4%–1%:

- **About 80% is Sanskrit transliteration** (79.9% of "unlisted characters" in the classical corpus, 62.8% in the modern one). That is the declared scope boundary above — by design, not a miss.
- **The rest were genuine gaps.** Corpus auditing surfaced real omissions such as `ཞྭ` (in `ཞྭ་མོ`, "hat") and doubly-stacked forms like `གྲྭར` / `གྲྭས`. After the fix, the number of well-formed units newly *rejected* across those 3.14 M units was **0** — the repair did not break anything that previously passed.

Two clarifications that matter more than the numbers themselves:

1. These are **well-formed rates**, not accuracy. Accuracy requires a human-annotated gold standard (which of these are true misspellings vs. scribal variants), and that set has not been built yet. A well-formed rate is what the corpus can verify by itself.
2. The corpora contain their own noise (e.g. variant-reading marks in electronic Buddhist canons), so these figures are **coverage evidence**, not benchmark scores.

---

## What it does not do / 它不做的事

- **It does not check word choice.** If `ལྷ་ས` ("Lhasa") is typed as `ལྷ་ཟ`, both syllables are well-formed and no error is reported. This is a syllable-level engine, not a semantic proofreader.
- **Sanskrit transliteration is rejected by design** — a scope declaration, not a defect.
- **No variant characters, scribal variants, or dialect differences** are judged.
- **No word-boundary precision/recall figures yet** — that needs a human-annotated gold standard.
- **A syllable is the unit.** Ambiguity between "one word" and "should be split" is left to the application layer.

---

## Repository layout / 仓库结构

Seventeen files. No package manager, no bundler, no test framework — the whole thing is plain ES5-compatible JavaScript plus one HTML page.

```
tibetan_algorithm.js      validator: role templates + character compatibility + particle split
tibetan_data.json         the rule table: character roles, length templates, combination rules, variants
encoder.js                structural encoding: slots, stable identity, lossless full-text round trip
tibetan_generator.js      generator: candidate characters -> well-formed syllables and words
tibetan_tokenizer.js      tokenizer: running text -> syllable units
i18n.js + ui_texts.json    interface strings (Chinese / English / Tibetan)
Tibetan_Test_Suite.html   browser test suite: live check, batch audit, generator, keypad demo
test_encoder.js           round-trip and quality tests (35 assertions)
test_encoder_v2.js        encoder semantics tests (7 assertions)
start_server.py           zero-dependency static server (the page needs HTTP — see below)
README.md · LICENSE · LICENSE-COMMERCIAL.md · NOTICE
.gitignore · .gitattributes
```

> This repository is the **engine only**. Two things deliberately live elsewhere: the writing application built on it (a ProseMirror editor), and a Rust/WebAssembly port of the same rule table used for cross-validation — neither is needed to use this engine.
>
> No third-party assets are bundled: no dictionaries, no corpus, and **no font**. Tibetan text renders with the system font stack (`Noto Sans Tibetan`, `Microsoft Himalaya`, `Jomolhari`, …).

---

## Development / 开发与验证

**Engine (Node — nothing to install):**

```bash
node test_encoder.js          # 35 round-trip and quality assertions
node test_encoder_v2.js       # 7 encoder-semantics assertions
```

**Browser test suite:**

```bash
python start_server.py        # or: python -m http.server 8000
# then open http://localhost:8000/Tibetan_Test_Suite.html
```

> The page fetches `tibetan_data.json` and `ui_texts.json`, so it **must be served over HTTP**.
> Opening the file directly (`file://`) is blocked by the browser's CORS rules and the suite
> will report that it cannot load its data. `start_server.py` is a 60-line wrapper around
> `http.server` that also disables caching and opens the browser for you.

Rule-table changes are expected to come with test evidence: if the rule table changes, both suites above must still pass, and any newly rejected well-formed unit has to be explained.

---

## Contributing / 贡献

The most valuable contribution to a rule-driven system is a **counterexample**:

> a sentence that is wrongly reported as an error, or an error that is not reported.

A single counterexample is worth more than ten compliments: a rule table can only be trusted if real text can falsify it. Issues with Tibetan text samples are very welcome.

Also useful: more rule-table edge cases with real text samples, and ports of the same rule table to other ecosystems.

---

## Roadmap / 方向

- Hunspell dictionary export (rule table → flat affix/dic, for LibreOffice, Word and browser spellcheckers)
- Python / TypeScript bindings; a published npm package
- Validated transliteration (Wylie / EWTS) in both directions — convert, then check, and report where it fails
- Correction suggestions: insert a missing tsheg, split fused syllables, fix case-particle form
- Input method candidates generated from rules rather than collected from a word list
- OCR and speech-to-text post-processing at the structural layer

---

## Prior work / 先行技术

The idea of validating Tibetan syllables with formal rules is not new, and this project does not claim to have invented it. Related lines of work: Hunspell-based word-list spellcheckers (e.g. Debian's `hunspell-bo`), rule sets that pre-expand rules into prefix/suffix sets with an exception dictionary (《基于规则的藏文音节纠正算法》, *Journal of Chinese Information Processing*, 2025), statistical/model approaches, and component-decomposition plus collation patents (e.g. `CN106156006A/B`) with academic component-decomposition work from 2019.

What this project contributes is a specific set of engineering choices inside that space: no word list and no exception dictionary, online position-by-position validation instead of pre-expanded sets, a machine-readable explanation for every rejection, and a structural representation designed to serve downstream grammar and dictionary layers.

---

## License

**Dual-licensed: AGPL-3.0 for open source, commercial license for closed source.**

| Your use | What applies | Cost |
|---|---|---|
| Personal, study, research | [AGPL-3.0](LICENSE) | free |
| Teaching, non-commercial research, non-profit publishing (incl. universities and monasteries) | [AGPL-3.0](LICENSE) + non-profit exemption ([see §1 of the commercial license](LICENSE-COMMERCIAL.md)) | free |
| Your project is open source as a whole under AGPL-3.0 | [AGPL-3.0](LICENSE) | free |
| Commercial product, internal company use (no distribution, no public service) | [AGPL-3.0](LICENSE) | free |
| **Closed-source product, or a public service you do not want to open-source** | **[Commercial license](LICENSE-COMMERCIAL.md)** | paid |

In one sentence: **either comply with the AGPL and open your source, or buy a commercial license.**

Note that a commercial license is generally *not* needed for evaluation, internal use, or a network service that complies with AGPL §13 by offering its source. Read [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md) before writing to ask — it answers most questions. Commercial enquiries: **785136829@qq.com**.

> Copyright protects the *expression* (this code and the rule table `tibetan_data.json`), not the rules or the algorithm as such. Reimplementing the rules independently is not covered by this license; copying the code or the rule table is.

---

**让藏文文本校准更简单、更准确。**

---

## 中文版

### 一句话

**Byro Tibetan Syllable Guardian**（藏文音节守护者）的核心：一个**不查词表**的藏文音节校验器 —— 基于藏文正字法的形式化规则判定音节合法性，判错时能说清**哪一位、和哪一位不搭**；同一次解析还顺手产出音节的**七位结构**（前加字 / 上加字 / 基字 / 下加字 / 元音 / 后加字 / 再后加字），供格助词形态、融合格剥离、词典归一这些上层规则直接取用。

在线试用：**https://note.byrocode.online/** —— 打开就能用，不用注册，桌面 Chrome / Edge。

### 为什么不用词表

藏文里最常见的拼写问题不是"某个词拼错了"，而是**漏掉 ་（tsheg）导致两个音节贴成一个**：

```tibetan
བོད་ཀྱི་སྐད་ཡིག      ✅ 四个合法音节
བོདཀྱི་སྐད་ཡིག       ❌ 前两个音节粘成了一个
```

`བོད` 和 `ཀྱི` 各自都没错，词表看不出任何问题 —— 这个错误只存在于**音节结构**这一层，而它恰恰是学术界的规则系统明确列为"尚未有效纠正"的那一类。

所以这个引擎建立在三层形式化知识上：

| 层次 | 内容 |
|---|---|
| **① 字符角色** | 每个藏文字丁能担任哪几种角色。`ག` 可作前加字 / 基字 / 后加字，`ས` 还能作再后加字 |
| **② 长度模板** | 每种音节长度（1–7 字丁）下允许的角色排列 —— 基字+元音+后加字、前加字+基字+后加字、上加字+基字+下加字… |
| **③ 字符级搭配** | 具体哪些字符能同现：**相邻**位（基字对下加字）、**跨位**（前加字与基字之间隔着上加字照样有约束）、**三元**整体（上加字+基字+下加字，拆成两条两两规则不成立） |

判定是从粗到细的一条链：先按长度取模板比对角色排列，再逐对检查字符搭配。

> **规则表只说"什么不行"，没有定义约束的角色对一律放行。**

这条原则带来两个直接后果：**没有例外词表**（专名、新词、未登录拼写不会被误报，判定边界不由"收了多少词"决定）；**判定代价与词表规模无关**（一个音节至多 7 个码点、每种长度至多十几条模板，操作次数有常数上界，微秒级）。

梵文转写与音译专名（`ཱ`、`ཽ`、`ནྱ`、`པདྨ` 等）**按设计不在校验范围内**：正字法规则不该为另一套书写系统开口子。校验层判其非法，编码层原样无损承载，应用层只做标记、不改原文。

### 一次解析，两个产物

**校验器回答"对不对"，槽位表示回答"是什么"。** 后面这件事是藏文语法的刚需：

- `གི / ཀྱི / གྱི` 该用哪一个，不看这个词，看**前一个音节最后写出来的那个辅音**；
- 作格、向格这类融合形态，要先把后缀从音节里**剥**出来才拿得到词干；
- 词典去重与索引需要**跨 Unicode 写法稳定**的身份。

在字符串层做这些事，等于把正字法表抄第二遍，而抄出来的那一份迟早与校验器不一致。所以引擎解析音节时顺手产出一条**固定宽度的槽位记录**，"最后写出来的是哪个辅音"这类问题就变成了一次取位操作。

### 快速上手（中文）

```js
const raw = require('./tibetan_data.json');
const alg = require('./tibetan_algorithm.js');
const P = alg.prepareData(raw);
const check = (s) => alg.checkSyllable(s, P.charTags, P.sequenceTemplates, P.combinationRules, P.variantMap);

check('བོད');      // true
check('བསྒྲུབས');  // true
check('བོདཀྱི');   // false  漏 ་，两音节粘连
check('བབབ');      // false  前加字+基字+后加字 不成立
check('པཱ');       // false  梵文转写，按设计判非法

alg.checkSyllableWithLog('བབབ', raw).logs;   // 给出"哪一位"不合法的完整推理链
alg.splitParticleSyllable(Array.from('དགའི'.normalize('NFD')),
  P.charTags, P.sequenceTemplates, P.combinationRules, P.variantMap);   // ['དག','འི']（全形优先）
                                                                        // ['མཁའ','ི']（左边不成立时回落合并形）
```

```bash
node test_encoder.js          # 往返与质量套件（35 条断言）
node test_encoder_v2.js       # 编码器语义（7 条断言）

python start_server.py        # 或：python -m http.server 8000
# 然后打开 http://localhost:8000/Tibetan_Test_Suite.html
#
# 注意：这个页面要 fetch tibetan_data.json 与 ui_texts.json，所以**必须走 HTTP**。
# 直接双击打开（file://）会被浏览器的 CORS 规则拦掉 fetch，页面会提示加载数据失败。
```

> 本仓库**不附带任何第三方资源** —— 没有词典、没有语料、**也没有字体**。
> 藏文用系统字体栈渲染（`Noto Sans Tibetan` / `Microsoft Himalaya` / `Jomolhari` …）。

### 实测数字

| 指标 | 数值 |
|---|---|
| 单音节判定 | 微秒级（操作次数有常数上界） |
| 10 万音节纯校验（无记忆化） | 178.6 ms ≈ **0.56 M 音节/秒**（Node 25.2.1，单机实测；多次复跑 175–205 ms） |
| 同一语料 + 音节级记忆化 | **6.1 ms**（复跑 6.1–7.2 ms），约 **26 倍** |
| 运行依赖 | **零第三方依赖**（Unicode NFD 归一化用内置的 `String.prototype.normalize`） |
| 源码规模 | 7 个模块、约 1,900 行 JavaScript + 7.5 KB 规则表，无构建步骤 |
| 语料合法率 | 德格版《甘珠尔》律藏 314 万音节单元 **99.58%**；现代百科体藏文 8.7 万音节单元 **99.03%** |

口径说明：吞吐量测的是进程内**纯校验**（不含分词与 I/O），语料是 12 个不同音节的高重复串 —— 既近似真实文本约 95% 的重复率，也是单次 JS 调用开销被放大 10 万次的最坏情形。这里是**合法率**而不是准确率 —— 准确率需要人工标注的黄金标准（哪些是真错、哪些是抄本异写），那份标注还没建。语料本身也带噪音（电子佛典的异文校勘符号），所以这些数字是**覆盖度证据**，不是性能指标。剩下那 0.4%–1% 里约八成是梵文转写（按设计范围之外），其余是真漏（如 `ཞྭ`、`གྲྭར` / `གྲྭས`），补上之后 314 万单元里"合法被判成非法"的翻转是 **0**。

### 它不做的事

- 管不了**用词**：`ལྷ་ས` 写成 `ལྷ་ཟ`，两个音节都合法，不报。
- 梵文转写按设计判非法 —— 这是范围声明，不是缺陷。
- 不判异体字、抄本异写、方言差异。
- 词边界层面的准确率与召回率还没有正式数字，那需要人工标注的黄金标准。
- **一个音节就是一个原子**："是词还是该切开"的歧义留给应用层。

### 参与

规则驱动的系统最需要的不是夸奖，而是**反例**：哪一句被误报、哪一句该报而没报。一个反例比十句夸奖有用 —— 规则表只有能被真实语料证伪才可信。带藏文样本的 issue 非常欢迎。

### 许可

**双许可：开源走 AGPL-3.0，闭源商用需购买授权。**

| 你的用法 | 适用条款 | 费用 |
|---|---|---|
| 个人学习、研究、自用 | [AGPL-3.0](LICENSE) | 免费 |
| 教学、非商业研究、非营利出版（含高校、寺院） | [AGPL-3.0](LICENSE) + 非营利豁免（[商用授权说明 §一](LICENSE-COMMERCIAL.md)） | 免费 |
| 自己的项目整体以 AGPL-3.0 开源 | [AGPL-3.0](LICENSE) | 免费 |
| 公司内部使用（不分发、不对外提供服务） | [AGPL-3.0](LICENSE) | 免费 |
| **闭源商业产品，或不想开源的对外服务** | **[商用授权](LICENSE-COMMERCIAL.md)** | 付费 |

一句话：**要么按 AGPL 开源，要么来买商用授权。**

注意：评估、内部使用、以及按 AGPL §13 提供源码的对外服务，通常**不需要**商用授权。写信来问之前先看 [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md) —— 常见问题都在里面。商用咨询：**785136829@qq.com**。

> 著作权保护的是**表达**（这套代码与规则表 `tibetan_data.json`），不是规则或算法本身。独立重写规则不受本许可约束；**复制代码或规则表**才受约束。
