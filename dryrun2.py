#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, '.')
from fix_mojibake import fix_text

with open('js/english-learning.js', 'rb') as f:
    text = f.read().decode('utf-8')

new_text, n = fix_text(text)
print(f'Fixed {n} chunks\n')

# 查找是否还有遗留乱码（典型乱码高频字）
import re
remnant_pat = re.compile(r'[鏆閫鍒鐧鐢璇鏆宸鍙鍗鍕闃鎴澶鍑馃鎼閴鐨瑙鏈鍔鍖瀹蹇鎵涓鏂閲淇鍙鍚鏃鍚庣鏅绠鍏€€妫鍒囨崲娣鍏抽棴]')
lines = new_text.split('\n')
issues = 0
for i, line in enumerate(lines, 1):
    if remnant_pat.search(line):
        print(f'  L{i}: {line.strip()[:120]}')
        issues += 1
        if issues >= 30: break
print(f'\nRemnant suspect lines: {issues}')
