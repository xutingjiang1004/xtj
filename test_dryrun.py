#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, '.')
from fix_mojibake import fix_text, try_restore

with open('js/english-learning.js', 'rb') as f:
    text = f.read().decode('utf-8')

import re
pattern = re.compile(r'[\u0080-\uffff\u2600-\u27bf\U0001f000-\U0001ffff]+')
count = 0
shown = 0
for m in pattern.finditer(text):
    chunk = m.group(0)
    restored = try_restore(chunk)
    if restored and restored != chunk:
        count += 1
        if shown < 35:
            ctx_start = max(0, m.start()-15)
            ctx_end = min(len(text), m.end()+15)
            ctx_before = text[ctx_start:m.start()].replace('\n','↵')
            ctx_after = text[m.end():ctx_end].replace('\n','↵')
            print(f'[{count:3d}] "{chunk}" → "{restored}"')
            print(f'      ...{ctx_before}[{chunk}]{ctx_after}...')
            shown += 1
print(f'\nTotal chunks to fix: {count}')

# Also verify that normal Chinese isn't touched
test_normals = ['离线模式', '已删除', '我的单词', '生成练习', '单词库', '全部', '删除']
for t in test_normals:
    r = try_restore(t)
    status = 'SAFE (untouched)' if r is None or r == t else f'WARN → "{r}"'
    print(f'  normal text "{t}": {status}')
