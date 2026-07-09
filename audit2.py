#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""精确审计所有文件中残余的中文乱码字符串字面量"""
import os
import re

def has_mojibake(s):
    # 私用区字符 → 绝对是乱码残留
    for c in s:
        if 0xE000 <= ord(c) <= 0xF8FF:
            return True
    # 连续出现的mojibake特征字组合（这些字符只出现在mojibake里，不会出现在正常中文中）
    # 用2-gram检测
    bad_pairs = [
        '鏈', '鍒', '鐢', '璇', '鎴', '澶', '鍑', '馃', '鎼', '閴',
        '璋', '鍙', '鍚', '宸', '鍐', '鎸', '鎸', '鍕', '词义',
        '删除', '鏈湴', '纭畾', '瑙ｆ瀽', '失败', '瑙嗚',
        '鐪熺瓟妗', '鐢焅emove', '娓呮帀', '鍙兘瀛樺湪', '鏃ュ織',
        '鎬濊€', '鏌ョ湅', '宸叉€', '已搜索', '閫€鍑', '閲嶆柊',
        '鐧诲綍', '准备中', '单选', '鍒囧皹', '妫€鏌', '閰缃',
        '鏃ュ織', '鍏抽棴', '鍏抽棴', '鍏抽棴', '鐞嗗憳', '鈽', '鈥',
        '锛岃', '锛屽叿', '鍒欎笉', '闇€瑕', '鍏跺疄', '涓嶅奖',
        '鍐嶄娇', '鐢ㄦ埛', '涓嶈嚦', '浜庡畬', '鍏ㄥ崱', '鍚庡彨',
        '鐢ㄥ叾', '鎺ㄧ悊', '寮曟搸', '鐪嬭捣', '鏉ヨ兘', '瑙勫垝',
        '鏇村ソ', '瀹炵幇', '闀跨瘒', '鑷劧', '璇█', '鍥炵瓟',
        '涓€绯诲垪步', '闂', '璁稿', '瑕佹€濊€', '〃鐜版洿',
        '绋冲畾', '閲嶈', '鐗圭偣', '杩愯', '鏈湴', '渚嬪',
        '绛変笂', '闇€瑕佹椂', '浜掍綔', '闅愮', '淇濇姢', '閫熷害',
        '鍙潬', '鎬т紭', '鍔跨敤', '鎴蜂笉', '瑕佸崟', '鐙畨',
        '瑁呮墦寮€', '鏀寔', '涓婁娇', '鐢ㄦ彁渚', '涜澶囦笂',
    ]
    # 任何一个典型坏词都算
    for p in bad_pairs:
        if p in s:
            return True
    # 大量问号连在一起
    if '???' in s or '????????' in s:
        return True
    return False

def scan_file(path):
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            text = f.read()
    except Exception:
        return []
    lines = text.split('\n')
    issues = []
    for m in re.finditer(r"""(?P<q>['"`])(?P<s>(?:\\.|(?!(?P=q)).)*)(?P=q)""", text):
        s = m.group('s')
        if len(s) < 2:
            continue
        if has_mojibake(s):
            line_no = text[:m.start()].count('\n') + 1
            line = lines[line_no - 1] if line_no - 1 < len(lines) else ''
            line = line.strip()
            if len(line) > 140:
                line = line[:140] + '...'
            issues.append((line_no, s, line))
    return issues

def main():
    targets = []
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist', 'build', '.idea', '.vscode')]
        for fn in files:
            if fn.lower().endswith(('.js', '.css', '.html', '.json', '.py')):
                if fn.startswith('fix_mojibake') or fn.startswith('audit_') or fn.startswith('test_') or fn.startswith('inspect_') or fn.startswith('dryrun') or fn.startswith('analyze'):
                    continue
                if fn.endswith('.min.js') or fn.endswith('.min.css'):
                    continue
                if fn == 'package-lock.json':
                    continue
                p = os.path.join(root, fn)
                targets.append(p)
    total_issues = 0
    files_with_issues = 0
    for p in sorted(targets):
        issues = scan_file(p)
        if issues:
            files_with_issues += 1
            print(f'\n=== {p} ({len(issues)} issues) ===')
            for line_no, s, line in issues[:40]:
                display = s[:100] + ('...' if len(s) > 100 else '')
                print(f'  L{line_no}: {repr(display)}')
            if len(issues) > 40:
                print(f'  ... and {len(issues) - 40} more')
            total_issues += len(issues)
    print(f'\nTotal: {total_issues} mojibake strings across {files_with_issues} files.')

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    main()
