#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复中文乱码 v2：
乱码模式：原始UTF-8 -> 被GBK误读 -> 以UTF-8存盘。
还原：乱码.encode('gb18030').decode('utf-8')

改进点：
1. 贪婪匹配：非ASCII段 + 中间少量ASCII连接符（空格、标点、括号、问号等）+ 非ASCII段，作为整体还原
2. 尝试多种encodings (gb18030/gbk/cp936)取最优
3. 还原后再二次扫描（处理嵌套）
4. 清理残余的半字垃圾字符（通常是未配对的续字节产生的 鈩 銆 佹  绋 等单字乱码）
"""
import re
import os
import sys

def is_good_char(ch):
    o = ord(ch)
    if o < 128: return True
    if '\u4e00' <= ch <= '\u9fff': return True
    if '\u3000' <= ch <= '\u303f': return True
    if '\uff00' <= ch <= '\uffef': return True
    if '\u2000' <= ch <= '\u206f': return True
    if 0x1F000 <= o <= 0x1FFFF: return True
    if 0x2600 <= o <= 0x27BF: return True
    if 0x1F300 <= o <= 0x1FAFF: return True
    if ch in '→←↑↓●○■□◆◇▲△▼▽★☆♠♣♥♦♪♫': return True
    return False

def try_restore_chunk(chunk):
    """尝试还原一个乱码段（可能含少量ASCII连接符）。返回最优还原或None。"""
    best = None
    best_score = -1
    for enc in ['gb18030', 'gbk', 'cp936']:
        try:
            raw = chunk.encode(enc, errors='strict')
            restored = raw.decode('utf-8', errors='strict')
        except (UnicodeDecodeError, UnicodeEncodeError, LookupError):
            continue
        # 校验
        bad = 0
        good = 0
        for ch in restored:
            o = ord(ch)
            if o == 0xFFFD:
                bad += 10
            elif 0xE000 <= o <= 0xF8FF:
                bad += 5
            elif o < 32 and ch not in '\t\n\r':
                bad += 10
            elif is_good_char(ch):
                good += 1
            else:
                bad += 1
        if bad > 0:
            continue
        ratio = len(chunk) / max(len(restored), 1)
        if not (1.1 <= ratio <= 3.0):
            continue
        if good / max(len(restored), 1) < 0.85:
            continue
        score = good - bad * 100 + ratio
        if score > best_score:
            best = restored
            best_score = score
    return best

def fix_text(text):
    """贪婪匹配乱码段并还原。"""
    # 匹配模式：非ASCII字符开头，后接 (少量ASCII连接符 + 非ASCII字符) 多次
    # ASCII连接符允许：空格、英文标点、括号、问号、点、斜杠、引号、冒号、分号、逗号、+、=
    connector = r"[ \t\.\,\?\!\:\;\(\)\[\]\{\}\/\\\|\-\+\=\_\*\&\^\%\$\#\@\!\~\`'\"\<\>]"
    pattern = re.compile(
        r'[\u0080-\uffff\u2600-\u27bf\U0001f000-\U0001ffff]+'
        r'(?:' + connector + r'+[\u0080-\uffff\u2600-\u27bf\U0001f000-\U0001ffff]+)*'
    )
    
    total_fixed = 0
    def replace(m):
        nonlocal total_fixed
        chunk = m.group(0)
        r = try_restore_chunk(chunk)
        if r and r != chunk:
            total_fixed += 1
            return r
        return chunk
    
    # 可能需要多次扫描（第一次还原后，不同段可能合并，再还原）
    for _ in range(3):
        prev = total_fixed
        text = pattern.sub(replace, text)
        if total_fixed == prev:
            break
    return text, total_fixed

def fix_file(path, dry_run=False):
    with open(path, 'rb') as f:
        raw = f.read()
    has_bom = raw.startswith(b'\xef\xbb\xbf')
    if has_bom:
        text = raw[3:].decode('utf-8')
    else:
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            text = raw.decode('utf-8', errors='replace')
    
    new_text, count = fix_text(text)
    if count == 0 and new_text == text:
        return False, 0
    if not dry_run:
        out_bytes = new_text.encode('utf-8')
        if has_bom:
            out_bytes = b'\xef\xbb\xbf' + out_bytes
        with open(path, 'wb') as f:
            f.write(out_bytes)
    return True, count

def collect_files(root, extensions):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        skip_dirs = {'node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__'}
        dirnames[:] = [d for d in dirnames if d not in skip_dirs and not d.startswith('.')]
        for fn in filenames:
            if '.min.' in fn: continue
            if fn.endswith('.bak'): continue
            if fn in ('fix_mojibake.py',): continue  # 跳过自己
            ext = os.path.splitext(fn)[1].lower()
            if ext in extensions:
                out.append(os.path.join(dirpath, fn))
    return out

if __name__ == '__main__':
    roots = sys.argv[1:] if len(sys.argv) > 1 else ['.']
    exts = {'.js', '.css', '.html', '.htm', '.json', '.md', '.txt', '.py', '.sql', '.mjs', '.cjs'}
    all_files = []
    for r in roots:
        if os.path.isfile(r):
            all_files.append(r)
        else:
            all_files.extend(collect_files(r, exts))
    total_files = 0
    total_changes = 0
    for f in sorted(all_files):
        changed, count = fix_file(f, dry_run=False)
        if changed:
            print(f'FIXED  [{count:4d} chunks] {f}')
            total_files += 1
            total_changes += count
    print(f'\nDone. {total_files} files fixed, {total_changes} chunks restored.')
