#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 尝试多种解码方向
import sys

test_cases = [
    ('暂无释义', '应该是：暂无释义'),
    ('请先登录后再生成练习', '应该是：请先登录后再生成练习'),
    ('凭据异常', '应该是：凭据异常'),
    ('暂无聊天记录', '应该是：暂无聊天记录'),
    ('登录', '应该是：登录'),
    ('生成练习', '应该是：生成练习'),
    ('如果', '应该是：如果'),
    ('防止', '应该是：防止'),
    ('成功', '应该是：成功'),
    ('失败', '应该是：失败'),
]

# 乱码字符用UTF-8编码得到字节，试各种编码
for s, expected in test_cases:
    b = s.encode('utf-8')
    print(f'\n=== {s}  (期望: {expected}) ===')
    for enc in ['gbk', 'gb2312', 'gb18030', 'big5', 'cp936', 'latin1']:
        try:
            dec = b.decode(enc)
            print(f'  {enc:10s}: {dec}')
        except Exception as e:
            print(f'  {enc:10s}: ERR {type(e).__name__}')
