#!/usr/bin/env python3
# -*- coding: utf-8 -*-
with open('js/english-learning.js', 'rb') as f:
    text = f.read().decode('utf-8')

import re
# 找典型半字截断位置
for m in re.finditer(r'[\u4e00-\u9fff][?]', text):
    i = m.start()
    ctx = text[max(0,i-20):i+20]
    ch = text[i]
    q = text[i+1]
    cp = ord(ch)
    print(f'U+{cp:04X} {ch} followed by U+{ord(q):04X} {q} : {ctx!r}')
print('---')
# 另外查 鈥 撯€ 这种组合
for s in ['鈥撯€?', '?', '€?', '?']:
    print(f'{s!r} count: {text.count(s)}')
