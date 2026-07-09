#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re

files = ['js/english-learning.js', 'js/ai-agent.js', 'js/core.js', 'js/features.js', 'css/desktop.css', 'index.html', 'css/english-learning.css', 'css/ai-agent.css']
suspect_re = re.compile(r'[鏆閫鍒鐧鐢璇鎴澶鍑馃鎼閴鐨瑙鏈鍔鍖瀹蹇鎵涓鏂閲淇鍙鍚鏃鍚庣鏅绠鍏€€妫鍒囨崲娣鍏抽棴宸鍗鍕闃鏂板鐢熸垚鎴愬姛澶辫触濡備綍姝ｇ‘閿欒]')
total = 0
for fp in files:
    try:
        with open(fp, 'rb') as f:
            text = f.read().decode('utf-8', errors='replace')
    except: continue
    lines = text.split('\n')
    issues = []
    for i, line in enumerate(lines, 1):
        if suspect_re.search(line):
            issues.append((i, line.rstrip()[:130]))
    print(f'\n=== {fp}: {len(issues)} suspect lines ===')
    for ln, content in issues[:25]:
        print(f'  L{ln}: {content}')
    total += len(issues)
print(f'\nTotal suspect lines: {total}')
