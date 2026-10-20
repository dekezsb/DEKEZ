# PDF Unicode font

`NotoSansSC-Regular.ttf` is a static weight-400 instance of Google's Noto Sans SC,
licensed under the SIL Open Font License in `NotoSansSC-LICENSE.txt`.

Source: https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf

Instantiated locally with fontTools 4.60.1 (`instantiateVariableFont`, `wght=400`).
SHA-256: `cd0b794308e16b6815f6b44d27fc6ffd58fce5df0bd2564ea9ca1bfa61b43306`.

The PDF renderer embeds the static font in full to preserve CJK composite glyphs.
ASCII uses supported standard Helvetica. Tests must check rendered Chinese pages,
not just successful PDF creation or text extraction.
