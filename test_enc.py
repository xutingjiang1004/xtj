#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 直接测试还原
samples = [
    '暂无释义', '选择', '删除', '离线模式', '·', '銆', 
    '锛', '登录', '暂无', '宸插垹闄', '用户要求',
    '璇ュ崟璇嶅湪鍗曡瘝搴撲腑閲婁箟涓'
]
for s in samples:
    try:
        b = s.encode('utf-8')
        r = b.decode('gb18030', errors='strict')
        print(f'{s} -> {r}')
    except Exception as e:
        print(f'{s} -> ERR: {e}')
