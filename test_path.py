#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 复现analyze.py的"utf8->gbk->utf8"路径：S(mojibake) -> encode utf-8 to get bytes B -> decode utf-8 back to S (no-op),
# 不对，analyze.py里是：
#   s2 = b.decode('utf-8')   # B is the UTF-8 bytes of mojibake, decode as UTF-8 → original mojibake string S
#   b1 = s2.encode('gbk')    # re-encode S with GBK → bytes B1
#   s_orig = b1.decode('utf-8')  # decode B1 as UTF-8 → original Chinese
# Wait that's what analyze shows worked. Let me test:
s_mojibake = '暂无释义'
B = s_mojibake.encode('utf-8')
s2 = B.decode('utf-8')  # should equal s_mojibake
B1 = s2.encode('gbk', errors='strict')
s_orig = B1.decode('utf-8', errors='strict')
print(f'Path A works: {s_mojibake} -> {s_orig}')
print(f'B1 hex: {B1.hex()}')

# Expected correct Chinese:
correct = '暂无释义'
print(f'Expected hex: {correct.encode("utf-8").hex()}')

# Now test all samples
samples = [
    '暂无释义', '选择', '删除', '登录', '生成练习',
    '请先登录后再生成练习', '暂时没有回应', '暂无聊天记录',
    '如果', '防止', '成功', '失败', '凭据异常',
    '🐾', '🔍', '📄', '搜索来源', '鉴权凭据缺失',
    '的中文释义最接近', '宸插垹闄', '按钮', '用户要求',
    '单词', '词义', '错误', '正确', '工作',
]
for s in samples:
    try:
        b1 = s.encode('gbk')
        orig = b1.decode('utf-8')
        ok = '✓' if all('\u4e00' <= c <= '\u9fff' or ord(c) > 0x1F000 or c in ' :，。、！？（）【】！...？·' for c in orig) else '?'
        print(f'{ok} {s} -> {orig}')
    except Exception as e:
        print(f'X {s} -> ERR {type(e).__name__}: {e}')
        # try gb18030
        try:
            b1 = s.encode('gb18030')
            orig = b1.decode('utf-8')
            print(f'  via gb18030: {orig}')
        except Exception as e2:
            print(f'  gb18030 also ERR: {e2}')
