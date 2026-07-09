#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""深度分析乱码编码链。"""

def analyze(mojibake, hints=None):
    b = mojibake.encode('utf-8')
    print(f'\n=== {mojibake} ===')
    print(f'UTF-8 bytes ({len(b)}): {b.hex()}')
    
    # 尝试1: 字节当GBK/GB18030解码
    for enc in ['gbk', 'gb18030', 'cp936', 'big5', 'shift_jis', 'euc-kr', 'euc-jp']:
        try:
            d = b.decode(enc, errors='strict')
            # 判断是否合理：d的UTF-8编码应该...
            d_bytes = d.encode('utf-8')
            cn = sum(1 for c in d if '\u4e00' <= c <= '\u9fff')
            print(f'  bytes as {enc:10s}: {repr(d)}  (cn_chars={cn})')
        except Exception as e:
            pass
    
    # 尝试2: 双重UTF-8（UTF-8的UTF-8再解码）
    # 即：原始S -> UTF-8编码为B1 -> B1当Latin1得到字符串S2 -> S2的UTF-8编码B2 -> B2存盘
    # 还原：B2 -> UTF-8解码得S2 -> S2当Latin1编码回B1 -> B1当UTF-8解码得S
    try:
        s2 = b.decode('utf-8')
        b1 = s2.encode('latin1')
        s_orig = b1.decode('utf-8')
        cn = sum(1 for c in s_orig if '\u4e00' <= c <= '\u9fff')
        print(f'  double-utf8:   {repr(s_orig)}  (cn_chars={cn})')
    except Exception as e:
        print(f'  double-utf8: ERR {e}')
    
    # 尝试3: 三重编码（S -> UTF-8 -> GBK读 -> UTF-8存）
    # 即：S->UTF-8(B1) -> 当GBK解码为S2 -> S2->UTF-8(B2=现在的字节)
    # 还原：B2->UTF-8得S2 -> S2->GBK编码回B1 -> B1->UTF-8解码得S
    for enc in ['gbk', 'gb18030', 'cp936']:
        try:
            s2 = b.decode('utf-8')
            b1 = s2.encode(enc)
            s_orig = b1.decode('utf-8')
            cn = sum(1 for c in s_orig if '\u4e00' <= c <= '\u9fff')
            print(f'  utf8->{enc}->utf8: {repr(s_orig)}  (cn_chars={cn})')
        except Exception as e:
            pass
    
    # 尝试4: 反方向：mojibake是某emoji被GBK解读
    # 常见emoji：💡 🔍 📎 📝 ⚡ 🚀 ✨ 🤔 🧠 📄 📁 💬 🤖
    emojis = '💡🔍📎📝⚡🚀✨🤔🧠📄📁💬🤖🎯🌟🔥💭✅❓❗🎉👍👀🎵🔮🌀💪🎤📚🌐'
    for em in emojis:
        emb = em.encode('utf-8')
        try:
            as_gbk = emb.decode('gbk', errors='strict')
            if as_gbk == mojibake:
                print(f'  MATCH EMOJI: {em} -> GBK read -> {mojibake}')
        except:
            pass
    
    # 尝试5: 原中文是S，S->GBK编码->UTF-8解码得到mojibake
    # 即 mojibake == S.encode('gbk').decode('utf-8', errors='replace')
    # 这个需要猜S，太耗时，先跳过
    
    print()

samples = [
    '暂无释义',
    '选择',
    '删除',
    '登录',
    '生成练习',
    '请先登录后再生成练习',
    '暂时没有回应',
    '暂无聊天记录',
    '如果',
    '防止',
    '成功',
    '失败',
    '凭据异常',
    '🐾',
    '🔍',
    '📄',
    '搜索来源',
    '鉴权凭据缺失',
    '的中文释义最接近',
    '璇ュ崟璇嶅湪鍗曡瘝搴撲腑閲婁箟涓?',
    '已删除?',
    '按钮',
    '用户要求',
    '单词',
    '勾选?',
    '词义',
    '错误',
    '正确',
    '工作',
]

for s in samples:
    analyze(s)
