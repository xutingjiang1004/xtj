# -*- coding: utf-8 -*-
"""ai-agent.js 漏网乱码注释语义重写（保留 CRLF，逐行精确替换）"""
import re, sys

PATH = 'js/ai-agent.js'
with open(PATH, encoding='utf-8', newline='') as f:
    lines = f.readlines()

# old(乱码, strip 后) -> new(语义重写)
REPL = {
    '// 鈽?U3: 涓?TTL 涓€鑷? 閬垮厤姣忓垎閽熷仛鏃犵敤鍔?': '// ★ U3: 与 TTL 保持一致，避免每分钟做无用功',
    '// 鈽?M: thinking_mode 榛樿浠?low 改成 max': '// ★ M: thinking_mode 默认从 low 改成 max',
    '//   绠＄悊鍛樺彲鍦ㄥ悗鍙?/admin/ai-agent/config 鍒囨崲涓?low/medium/high/max': '//   管理员可在后台 /admin/ai-agent/config 切换为 low/medium/high/max',
    '//   鏅€氱敤鎴蜂笉鑳藉湪 UI 切换 (allow_user_thinking_switch: false)': '//   普通用户不能在 UI 切换 (allow_user_thinking_switch: false)',
    '// 鈽?M: 深度思考冩ā寮?toggle 鐘舵€?': '// ★ M: 深度思考模式 toggle 状态',
    '//   寮€鍚悗鏈細璇濇墍鏈夋秷鎭蛋 Planner鈫扺orkers鈫扴ynthesizer 澶?agent 流程': '//   开启后所有消息走 Planner→Workers→Synthesizer 多 agent 流程',
    'var _menuAbort = null; // 鈽?U3: 绠＄悊澶嶅埗鑿滃崟鐨?document 鐩戝惉鍣?': 'var _menuAbort = null; // ★ U3: 管理复制菜单的 document 监听器',
    '// 鈽?U3: 如果 version 鐩稿悓涓斿凡鏈夊唴瀹? 璺宠繃閲嶅缓 (閬垮厤姣忓垎閽熼噸鏂颁笅杞藉ご鍍?': '// ★ U3: 如果 version 相同且已有内容，跳过重建 (避免每分钟重新下载头像)',
    '// 鈽?U3: 鍔ㄦ€?currency 符号': '// ★ U3: 动态 currency 符号',
    '// 鈽?O 修复 Bug 4: 浠?history 恢复 think-card': '// ★ O 修复 Bug 4: 从 history 恢复 think-card',
    '// 鈽?Q 閲嶅仛: 鏋佺畝鐗?(涓?handleSendDeepThink 涓€鑷寸粨鏋?': '// ★ Q 重做: 极简版（与 handleSendDeepThink 一致结构）',
    '// 鈽?U2 重做: 4 瑙掑嚬鏄?sparkle (ChatGPT/Claude 风格, 替代菱形)': '// ★ U2 重做: 4 角凸起 sparkle (ChatGPT/Claude 风格, 替代菱形)',
    '// V5: 鍩轰簬鏃堕棿鎺ㄨ繘锛岄€傞厤涓嶅悓鍒锋柊鐜囷紱plainStream 鍗曟枃鏈妭鐐?+ 寰壒娆★紝閬垮厤姣忓抚寤鸿妭鐐瑰崱椤?': '// V5: 基于时间推进，适配不同刷新率；plainStream 单文本节点 + 微批次，避免每帧建节点卡顿',
    '// 鈽?U3: 缓存 querySelector 结果, 避免每个事件都做 DOM 查询': '// ★ U3: 缓存 querySelector 结果, 避免每个事件都做 DOM 查询',
    '// 鍒囨崲深度思考冩ā寮忥細鏀逛负鎵撳紑鐙珛浜岀骇椤甸潰锛屼笉鍐嶅垏鎹㈡櫘閫氳亰澶╃殑 S.deepThink': '// 切换深度思考模式：改为打开独立二级页面，不再切换普通聊天的 S.deepThink',
    '// 深度思考冨凡鏀逛负鐙珛浜岀骇椤甸潰锛屾櫘閫氳亰澶╀笉鍐嶆仮澶?deepThink 鐘舵€?': '// 深度思考已改为独立二级页面，普通聊天不再恢复 deepThink 状态',
    '// ===================== M: 深度思考冩ā寮忓彂閫?=====================': '// ===================== M: 深度思考模式发送 =====================',
    '//   杩涘害鍗″疄鏃舵洿鏂?(1-10 涓?agent 鐘舵€?': '//   进度卡实时更新 (1-10 个 agent 状态)',
    '// 鈽?U3 P0-3 修复: 只有存在真实的旧请求时才 abort, 避免误杀自己': '// ★ U3 P0-3 修复: 只有存在真实的旧请求时才 abort, 避免误杀自己',
    '// 鈽?P 鏂板: 浼犳€濊€冪▼搴︾粰鍚庣 runMultiAgentFlow (后端会用这个, 不用 config)': '// ★ P 新增: 传思考程度给后端 runMultiAgentFlow (后端会用这个, 不用 config)',
    '// 鈽?O 修复 Bug 4: 鏋勯€?think-card (鍙栦唬鏅€?ai-msg 节点)': '// ★ O 修复 Bug 4: 构建 think-card (取代旧的 ai-msg 节点)',
    '// 鈽?P 鏀? usage.thinking_mode 鍚屾瀹為檯鍊?': '// ★ P 改: usage.thinking_mode 同步实际值',
    '//   鎶樺彔鎬? 澶撮儴鏄剧ず "鈿?已思考 38s 路 5 涓?agent" + 折叠按钮': '//   折叠性: 头部显示 "● 已思考 38s · 5 个 agent" + 折叠按钮',
    '// V2: 流式渲染已在 answer_chunk 涓繘琛? done 时只 finish 鎴?markdown': '// V2: 流式渲染已在 answer_chunk 进行，done 时只 finish 成 markdown',
    '// 鏂囦欢涓婁紶鐘舵€?(dt 页面)': '// 文件上传状态 (dt 页面)',
    '// 娣卞害鐮旂┒椤甸潰婊氬姩鐩戝惉锛氱敤鎴峰悜涓婄炕鏃跺仠步㈣嚜鍔ㄦ粴鍔?': '// 深度研究页面滚动监听：用户向上翻时停止自动滚动',
    '// 娌℃湁鐩存挱鎼滅儲鏉★紙濡傚巻鍙查噸寤猴級锛屽垱寤轰竴涓畝鐗?': '// 没有直播搜索条（如历史重建），创建一个简版',
    '// 鎬濊€冨悗琛ュ厖鎼滅儲锛氶噸缃唴瀹圭姸鎬佷互鎺ユ敹鏂颁竴杞?stream锛屼繚鐣欏凡鏄剧ず鐨勬€濊€冭繃绋?': '// 思考后补充搜索：重置内容状态以接收新一轮 stream，保留已显示的思考过程',
    '// 鏄剧ず鎼滅儲鐘舵€佹潯': '// 显示搜索状态条',
    '// 鏄剧ず浣跨敤鐨?provider': '// 显示使用的 provider',
    '// 如果 reasoning_start 浜嬩欢涓㈠け锛岄娆℃敹鍒?reasoning 也启动计时器': '// 如果 reasoning_start 事件丢失，首次收到 reasoning 也启动计时器',
    '// sanitized_content 浼樺厛锛氬悗绔竻娲楀悗鐨勬鏂?': '// sanitized_content 优先：后端清洗后的正文',
    '// 涓柇/鏈繚瀛樻彁绀?': '// 中断/未保存提示',
    '// 已在 done/error 浜嬩欢涓畬鎴愭覆鏌?': '// 已在 done/error 事件中完成渲染',
    '// 浠?S.conversations 涓Щ闄?': '// 从 S.conversations 中移除',
    '// 濡傛灉删除鐨勬槸褰撳墠瀵硅瘽锛岄噸缃?': '// 如果删除的是当前对话，重置',
    '// 鈽?M: 鎭㈠深度思考冩ā寮忕姸鎬?': '// ★ M: 恢复深度思考模式状态',
    '// 鍏抽棴深度思考冧簩绾ч〉闈紝閬垮厤瀹冩畫鐣欏湪鏅€氳亰澶╀箣涓?': '// 关闭深度思考二级页面，避免它残留在普通聊天之中',
}

hits = 0
for i, ln in enumerate(lines):
    stripped = ln.rstrip('\r\n')
    if stripped in REPL:
        lines[i] = REPL[stripped] + ('\r\n' if ln.endswith('\r\n') else '\n')
        hits += 1
    elif any(c in ln for c in ['鈽', '冩', '鐘', '鐨', '涓', '鍒', '鏄', '鏂', '鑾', '锛', '涓', '浜', '鐨', '杩', '鏇', '锛']):
        print(f'UNMATCHED L{i+1}: {ln.strip()[:90]}')

print(f'replaced: {hits} / expected: {len(REPL)}')
if hits != len(REPL):
    sys.exit(1)
with open(PATH, 'w', encoding='utf-8', newline='') as f:
    f.writelines(lines)
print('written')
