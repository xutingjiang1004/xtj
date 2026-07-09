#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增强版乱码修复脚本 - 处理半字截断和残余乱码
策略：
1. 再次运行贪婪匹配还原（针对第一轮漏掉的）
2. 清理私用区字符 (U+E000-U+F8FF)
3. 识别和替换已知的常见乱码片段
"""
import os
import re
import sys

# 常见乱码→正确中文的硬映射表（针对无法通过编码还原的半字截断情况）
KNOWN_FIXES = {
    # ai-agent.js
    'AI 鏈嶅姟璋冪敤澶辫触锛岃妫€鏌ラ厤缃垨鏈嶅姟鏃ュ織': 'AI 服务调用失败，请检查配置或服务日志',
    '宸叉€濊€': '已思考',
    '鏌ョ湅鎬濊€冭繃绋': '查看思考过程',
    '姝': '步',
    '宸叉悳绱': '已搜索',
    '深度思考冩ā寮忓凡琚鐞嗗憳鍏抽棴': '深度思考模式已被管理员关闭',
    '鍑嗗涓': '准备中',
    '鎬濊€冧腑': '思考中',
    '鎼滃偍涓': '搜索中',
    '鎼滃偍涓': '搜索中',
    '閴存潈鍑冨憡缂哄け锛岃閫€鍑哄悗閲嶆柊鐧诲綍鍐嶄娇鐢': '鉴权凭证缺失，请退出后重新登录再使用',
    '鐧诲綍鐘舵€佸紓甯革紝璇峰皾璇曞埛鏂伴〉闈㈠悗閲嶆柊鐧诲綍': '登录状态异常，请尝试刷新页面后重新登录',
    '文件不能超过 7MB (data URL 缂栫爜鍚': '文件不能超过 7MB（data URL 编码后）',
    '瑙ｆ瀽涓': '解析中',
    '鐢熸垚涓': '生成中',
    '鐢熸垚涓撳睘缁冧範': '生成专属练习',
    '鍗曢€': '单选',
    '绌': '空',
    '鏈湴纭畾鎬цВ鏋愪紭鍏': '本地确定性解析优先',
    'AI 澶辫触涓嶅奖鍝嶅鍏': 'AI 失败不影响导入',
    '瑙嗚鎬': '视觉态',
    '閫変簡鐪熺瓟妗': '选了真答案',
    '鐢焅emoveProperty 娓呮帀鍙兘瀛樺湪鐨': '用 removeProperty 清掉可能存在的',
    'important inline display, 璁': 'important inline display，让',
    'CSS 默认 (block) 生效': 'CSS 默认 (block) 生效',
    '宸插垹闄': '已删除',
    'AI 鎸夐挳 (鐢ㄦ埛瑕佹眰), 鍗曡瘝鍙繚鐣': 'AI 按钮（用户要求），单词只保留',
    '鍕鹃€': '勾选',
    '璇嶄箟': '词义',
    '鍒犻櫎': '删除',
    '鍚庣涓嶅彲鐢ㄦ椂, 鐢ㄦ湰鍦版ā鏉垮厹搴': '后端不可用时，用本地模板兜底',
    '鐢ㄦ埛涓嶈嚦浜庡畬鍏ㄥ崱浣': '用户不至于完全卡住',
    '澶辫触': '失败',
    '杩欐鏄敱鈥滆嫻鏋滈椤碘€濊繖涓€娈电洸鎬濊€冭繃绋嬩骇鐢熺殑銆俉TToP 鏄嫻鏋滃叕鍙稿唴閮ㄧ爺鍙戠殑涓€娆捐涓洪璁殑鎺ㄧ悊妯″瀷锛屾渶鍒濅笌 OpenAI 鐨 o3 绯诲垪绫讳技锛屼富瑕佺敤浜庤В鍐抽渶瑕佸姝ラ€昏緫鎺ㄧ悊鐨勫鏉傞棶棰橈紝鐗瑰埆鏄湪璋冨害銆佽鍒掔瓑闇€瑕佸鏉傚喅绛栫殑鍦烘櫙涓嬨€俒TToP 鍚庢潵閫愭笎浠庡唴閮ㄦ帹鐞嗘ā鍨嬫垚涓鸿嫻鏋滄櫤鑳戒綋绯荤殑缁熶竴鍩虹锛岀粡甯镐笌 Apple Intelligence 鐨勫椤瑰姛鑳界粨鍚堜娇鐢紝鏀寔璇煶鍔╂墜 Siri 鐨勬€荤粨銆佸啓浣滃伐鍏风殑鍐呭鎬荤粨涓庨噸鍐欍€佺収鐗囩殑鍙犲姞瑙嗛鍥炲繂锛屼互鍙婃浘鐗囥€佽棰戙€佸０闊虫潗鏂欑殑鏅鸿兘鏁寸悊绛変换鍔°€俒TToP 鏄竴娆惧紡鎺ㄧ悊妯″瀷锛屼笉鍍忓父瑙勮瑷€妯″瀷閭ｆ牱鐩存帴鐢熸垚闀跨瘒鑷劧璇█鍥炵瓟锛岃€屾槸閫氳繃涓€绯诲垪鎺ㄧ悊姝ラ瑙ｅ喅闂锛屽洜姝ゅ湪璁稿瑕佹€濊€冪殑鍦烘櫙涓嬭〃鐜版洿绋冲畾銆俒TToP 鐨勪竴涓噸瑕佺壒鐐规槸瀹冮€氬父杩愯鍦ㄨ澶囨湰鍦帮紙渚嬪 iPhone銆乁ac 绛変笂锛夛紝鍦ㄩ渶瑕佹椂鍙互涓庝簯绔ā鍨嬪崗浣滐紝鍥犳鍦ㄩ殣绉佷繚鎶ゃ€侀€熷害鍜屽彲闈犳€т笂鏈変竴瀹氫紭鍔裤€傜敤鏂规硶涓婏紝鐢ㄦ埛閫氬父涓嶉渶瑕佸崟鐙畨瑁呮垨鎵撳紑 LLM 锛屽彧瑕佸湪鏀寔 Apple Intelligence 鐨勮澶囦笂浣跨敤绯荤粺鎻愪緵鐨勬櫤鑳藉姛鑳斤紝灏变細鍦ㄥ悗鍙拌皟鐢ㄥ叾鎺ㄧ悊鑳藉姏銆俒TToP 鏄嫻鏋滃湪璁惧绔櫤鑳介娴嬨€佸唴瀹圭悊瑙ｅ拰澶氭鍐崇瓥鍦烘櫙涓嬬殑鏍稿績鎺ㄧ悊寮曟搸锛屽畠璁╁緢澶氱湅璧锋潵鈥滆兘鎯炽€佽兘鎬荤粨銆佽兘瑙勫垝鈥濈殑鍔熻兘鍙互鏇村ソ鍦板疄鐜般€俔': '这段是由"苹果首段"这一段曲推理过程产生的。LLM 是苹果公司内部研发的一款行为预训练的推理模型，最初与 OpenAI 的 o3 系列类似，主要用于解决需要多步逻辑推理的复杂问题，特别是在调度、规划等需要复杂决策的场景下。LLM 后来逐渐从内部推理模型成为苹果智能体系的统一基础，经常与 Apple Intelligence 的多项功能结合使用，支持语音助手 Siri 的总结、写作工具的内容总结与重写、照片的叠加视频回忆，以及图片、视频、音频材料的智能整理等任务。LLM 是一款式推理模型，不像常规语言模型那样直接生成长篇自然语言回答，而是通过一系列推理步骤解决问题，因此在许多需要思考的场景下表现更稳定。LLM 的一个重要特点是它通常运行在设备本地（例如 iPhone、Mac 等上），在需要时可以与云端模型协作，因此在隐私保护、速度和可靠性上有一定优势。使用方法上，用户通常不需要单独安装或打开 LLM，只要在支持 Apple Intelligence 的设备上使用系统提供的智能功能，就会在后台调用其推理能力。LLM 是苹果在设备端智能预测、内容理解和多步决策场景下的核心推理引擎，它让很多看起来"能想、能总结、能规划"的功能可以更好地实现。',
}

def is_mojibake_char(c):
    cp = ord(c)
    if 0xE000 <= cp <= 0xF8FF:
        return True
    if c in '鏆閫鍒鐧鐢璇鎴澶鍑馃鎼閴璋浜哄洜宸卞垹鎸夐挳鍕鹃€璇嶄箟鍒犻櫎鏈湴纭畾鎬цВ鏋愪紭鍏澶辫触涓嶅奖鍝嶅鍏瑙嗚鎬閫変簡鐪熺瓟妗夊凡鐢焅emoveProperty娓呮帀鍙兘瀛樺湪璁紝锛氾紱鐨勪簡鍦ㄦ槸鏈変笂涓笌涓轰互瀵瑰皬鎴戜滑浠庨噷鍚嶆棩鍙堜細鍙笅鑰屾湰鍓嶅畠鍚庡唴蹇冨寰楃瓑鐫€涔嬬劧鍚屽幓鑳藉洜鎯呯粰涔堟渶瑙侀亾鍚厛鏃╁叆闃舵瘮鍙樺皯鍎跨▼鍗佸叏鍥涗繚鍐欏憳鏍规湰鍏竷鍒欏仛鍔�€佸嵈璇存斁鏂逛簯鍥犲彧鏋滄兂鍒跺コ鎬荤敓鍥芥墜浜庡彧鍔ㄨ繘鎴氬悓鐜颁釜鏈変粠鏋佸悜鍔ㄩ潰缁撲笅绗﹀憡鍙栨潵鍦伴潰鏉ユ垚鍔熼兘鎵€浠ュ厜鍗佸垎鍙互闂互鍚庢闅炬€у厓鍏呯數涓讳俊鏂囨澂鎯充綍涔愭浠€涔堢瓑鍒拌繛鍚堟灄鏉ㄥ嚑浜嬪垽姣嶇埍鐖朵翰鐢熸€庝細鑷繁鍙戝悗鎴樺洖楂樺叴涓轰粈涔堜細涓ゅ悗涓€浜涚數鍘婚潰寮€瀹冪殑鍒繖涓や粯閲嶇幆鐧讳寒浜嬫儏闇€瑕佷綅浣撻棶蹇呰瀛﹁鍘嗗崈绔嬪叆娴佸洓鐧惧垎鎬讳綋鍙槸鍗楁垨鏀笢涓ゆ瀹冧滑鎯呭喌鏈€杩欏洖鍙皢鍚嶅瓧涓嶅皯寰堝ソ鎯呮櫙鍐呭宸笉澶氬浘绀句細鍙樺寲鍥藉涓栫晫閫夌敤銆佸啓杩囩▼璇硶鐭ヨ瘑鏃跺€欏墠鏂归潰缁忓父浣跨敤鐩墠鐮旂┒澶嶅埗绯荤粺璁惧鏅鸿兘鍔熻兘鍚庡彨鐢ㄥ叾鎺ㄧ悊鑳藉姏鏍稿績寮曟搸鐪嬭捣鏉ヨ兘鎬荤粨瑙勫垝鍙互鏇村ソ瀹炵幇鐩存帴鐢熸垚闀跨瘒鑷劧璇█鍥炵瓟涓€绯诲垪姝ラ瑙ｅ喅闂璁稿瑕佹€濊€冭〃鐜版洿绋冲畾閲嶈鐗圭偣杩愯鏈湴渚嬪绛変笂闇€瑕佹椂浜掍綔闅愮淇濇姢閫熷害鍙潬鎬т紭鍔跨敤鎴蜂笉瑕佸崟鐙畨瑁呮墦寮€鏀寔涓婁娇鐢ㄦ彁渚涜澶囦笂':
        return True
    return False

def try_restore_chunk(chunk):
    best = None
    best_score = -1
    for enc in ['gb18030', 'gbk', 'cp936']:
        try:
            raw = chunk.encode(enc, errors='strict')
            restored = raw.decode('utf-8', errors='strict')
        except Exception:
            continue
        if '\ufffd' in restored:
            continue
        bad = 0
        good = 0
        for c in restored:
            cp = ord(c)
            if 0xE000 <= cp <= 0xF8FF:
                bad += 2
            elif 0x4E00 <= cp <= 0x9FFF or 0x3000 <= cp <= 0x303F or 0xFF00 <= cp <= 0xFFEF or c in '，。！？：；""''（）【】《》、—…·':
                good += 1
            elif c.isascii() and (c.isalnum() or c in ' .,!?;:-_/\\()[]{}@#$%^&*+=<>\'"'):
                good += 0.3
            elif cp < 0x20 or c in '':
                bad += 1
        score = good - bad * 3
        ratio = len(restored) / max(1, len(chunk))
        if ratio < 1.1 or ratio > 3.0:
            continue
        if good / max(1, len(restored)) < 0.5:
            continue
        if score > best_score:
            best = restored
            best_score = score
    return best

def greedy_restore(text):
    for _ in range(3):
        out = []
        i = 0
        n = len(text)
        changed = False
        while i < n:
            if is_mojibake_char(text[i]):
                j = i
                while j < n and (is_mojibake_char(text[j]) or (text[j] in ' \t\n\r+-*/=<>()[]{}.,;:!?@#$%^&"\'_`~|\\' and j < n and j - i < 40)):
                    if not is_mojibake_char(text[j]):
                        if j + 1 >= n or not is_mojibake_char(text[j+1]):
                            break
                    j += 1
                chunk = text[i:j]
                restored = try_restore_chunk(chunk)
                if restored:
                    out.append(restored)
                    changed = True
                else:
                    out.append(chunk)
                i = j
            else:
                out.append(text[i])
                i += 1
        text = ''.join(out)
        if not changed:
            break
    return text

def remove_private_use(text):
    return ''.join(c for c in text if not (0xE000 <= ord(c) <= 0xF8FF))

def apply_known_fixes(text):
    for bad, good in KNOWN_FIXES.items():
        if bad in text:
            text = text.replace(bad, good)
    return text

def fix_file(path):
    with open(path, 'rb') as f:
        raw = f.read()
    for enc in ['utf-8-sig', 'utf-8', 'gb18030']:
        try:
            text = raw.decode(enc)
            break
        except Exception:
            continue
    else:
        return 0, 'decode fail'
    original = text
    text = apply_known_fixes(text)
    text = greedy_restore(text)
    text = remove_private_use(text)
    if text == original:
        return 0, 'no change'
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)
    return 1, 'fixed'

def main():
    targets = []
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist', 'build', '.idea', '.vscode', 'min', 'Gemini-Article-Animation.html')]
        for fn in files:
            if fn.lower().endswith(('.js', '.css', '.html', '.json', '.py', '.md', '.txt')):
                if fn.startswith('fix_mojibake') or fn.startswith('audit_') or fn.startswith('test_') or fn.startswith('inspect_') or fn.startswith('dryrun') or fn.startswith('analyze'):
                    continue
                if fn == 'package-lock.json':
                    continue
                p = os.path.join(root, fn)
                targets.append(p)
    total = 0
    fixed = 0
    for p in sorted(targets):
        n, status = fix_file(p)
        total += 1
        if n:
            fixed += 1
            print(f'[FIXED] {p}')
    print(f'\nDone. Scanned {total} files, fixed {fixed}.')

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    main()
