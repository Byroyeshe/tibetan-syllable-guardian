fonts/ —— 本目录只有一个文件属于第三方：Noto Serif Tibetan（藏文子集）

NotoSerifTibetan-Tibetan.woff2
  字形来源 : Noto Serif Tibetan v2.103
  上游仓库 : https://github.com/notofonts/tibetan
  取字方式 : Google Fonts 的 Tibetan unicode-range 子集
             (U+0F00-0FFF, U+200C-200D, U+25CC, U+3008-300B)
  版权     : Copyright 2022 The Noto Project Authors
  许可     : SIL Open Font License 1.1 —— 全文见同目录 OFL.txt

  为什么只用子集：完整 TTF 是 2.0 MB，藏文子集是 156 KB（十分之一），
  而叠字排版所需的 GSUB 特性（abvs / blws）与 GPOS 定位（abvm / blwm / mark / mkmk）
  全部保留。

  本字体**不在**本项目商用授权的范围内 —— 它由 OFL-1.1 单独授权，
  该许可本身就允许随任意软件（含闭源商业软件）再分发，无需另行付费。
  唯一两条限制：不得把字体**单独**出售；若修改字体，不得继续使用
  “Noto Serif Tibetan” 这个保留字体名。

  要换字体或换子集：见 landing/README-noto-font.md。
