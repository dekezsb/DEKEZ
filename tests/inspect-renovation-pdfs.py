"""Local PDF text/numerical checks; no connection to production data."""
import sys
from pathlib import Path

if len(sys.argv)>2:
    sys.path.insert(0,sys.argv[2])
from pypdf import PdfReader

directory=Path(sys.argv[1])
for lang in ('en','ms','zh'):
    reader=PdfReader(directory/f'renovation-{lang}.pdf')
    texts=[page.extract_text() for page in reader.pages]
    # PDF text extractors separate font runs (ASCII and Unicode ×) with newlines.
    # Normalize whitespace only; never normalize digits or technical symbols.
    text=' '.join('\n'.join(texts).split())
    for value in ('45,600.00','47,147.00','1,547.00','22,800.00','13,680.00','9,120.00','3247421720','DEKEZ SDN BHD','9MM G26','2" × 4"'):
        assert value in text,(lang,value)
    for i in range(1,24):
        assert f'PART-{i}' in text,(lang,i)
    if lang=='zh':
        for value in ('发票','隔墙','付款安排','条款与条件','马来西亚令吉肆万伍仟陆佰整'):
            assert value in text,value
    print(f'{lang}: {len(reader.pages)} pages; same totals, item codes, specifications and bank details confirmed')
