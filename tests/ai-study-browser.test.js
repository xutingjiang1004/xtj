'use strict';
// 小猫AI 顶栏「学习」入口：进入学习模式、填写学习资料、请求带上 study、退出后不再带。
const test = require('node:test'), assert = require('node:assert/strict');
const { aiPolishFixture } = require('./helpers/ai-polish-fixture');

const studyOn = page => page.evaluate(() => document.getElementById('aiChatRoot').classList.contains('ai-study-mode'));
async function send(page, text) {
  const before = await page.evaluate(() => aiPolish.streams.length);
  await page.fill('#aiChatMsgInput', text);
  await page.keyboard.press('Enter');
  await page.waitForFunction(n => aiPolish.streams.length > n, before);
  return page.evaluate(() => aiPolish.streams.at(-1).body);
}
async function finish(page, conversationId) {
  await page.evaluate(cid => {
    aiPolishEmit({ type: 'meta', conversation_id: cid });
    aiPolishEmit({ type: 'content', content: '【考点】时态' });
    aiPolishEmit({ type: 'done' });
    aiPolish.streams.at(-1).controller.close();
  }, conversationId);
  await page.waitForFunction(() => !document.querySelector('#aiChatRoot.ai-thinking, #aiChatRoot.ai-replying'));
}

test('learning mode: the cap button sits left of deep research, saves a profile and sends it with each question', async t => {
  const f = await aiPolishFixture({ viewport: { width: 1024, height: 768 } }); t.after(f.close);
  const page = f.page;
  const order = await page.evaluate(() => [...document.querySelectorAll('#aiChatRoot > .ai-chat-header > *')].map(n => n.id).filter(Boolean));
  assert.deepEqual(order, ['aiStudyToggle', 'aiDeepThinkToggle']);
  assert.equal(await page.locator('#aiStudyToggle svg').count(), 1);

  const normal = await send(page, '普通问题');
  assert.equal('study' in normal, false, 'ordinary chat sends no study field');
  await finish(page, 'POLISH01');

  // 已经聊过的对话里点「学习」：新开一段学习对话，并弹出学习资料表单。
  await page.locator('#aiStudyToggle').click();
  await page.waitForSelector('.ai-study-landing');
  assert.equal(await studyOn(page), true);
  assert.equal(await page.locator('.ai-chat-header-title b').textContent(), '学习');
  assert.equal(await page.locator('#aiStudyToggle').getAttribute('aria-pressed'), 'true');
  await page.locator('.ai-study-profile-card').click();
  await page.waitForSelector('#aiStudySheet');
  await page.selectOption('#aiStudySheet select >> nth=0', 'ielts');
  await page.fill('#aiStudySheet input >> nth=1', '6.5');
  await page.fill('#aiStudySheet input >> nth=2', '剑桥雅思初级教程（新东方）');
  await page.fill('#aiStudySheet input >> nth=3', '第 1 单元');
  await page.selectOption('#aiStudySheet select >> nth=1', 'guided');
  await page.locator('.ai-study-sheet-save').click();
  await page.waitForSelector('#aiStudySheet', { state: 'detached' });
  assert.match(await page.locator('.ai-study-profile-value').textContent(), /雅思（目标 6\.5） · 剑桥雅思初级教程（新东方） · 第 1 单元/);

  // 快捷入口把提示语放进输入框；「拍照答疑」打开的是图片选择。
  await page.locator('[data-study-starter="grammar"]').click();
  assert.equal(await page.inputValue('#aiChatMsgInput'), '请讲解这个语法点：');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-study-starter="photo"]').click();
  assert.equal((await chooser).isMultiple(), true);

  const body = await send(page, '请讲解这个语法点：现在完成时');
  assert.deepEqual(body.study, { exam: 'ielts', exam_other: '', target: '6.5', textbook: '剑桥雅思初级教程（新东方）', unit: '第 1 单元', style: 'guided', note: '' });
  assert.equal(body.conversation_id, 'POLISHNEW01');
  await finish(page, 'POLISHNEW01');
  assert.equal(await studyOn(page), true, 'the conversation stays a learning conversation after the reply');

  // 再点一次学士帽：退出学习模式，下一条消息不再带学习资料。
  await page.locator('#aiStudyToggle').click();
  await page.waitForFunction(() => !document.getElementById('aiChatRoot').classList.contains('ai-study-mode'));
  assert.equal(await page.locator('.ai-study-landing').count(), 0);
  assert.equal(await page.locator('.ai-chat-header-title b').textContent(), '小猫');
  const after = await send(page, '退出后的问题');
  assert.equal('study' in after, false);
  assert.deepEqual(f.errors, []);
});

test('learning mode on a phone: the form stays above the bottom dock and can be cancelled', async t => {
  const f = await aiPolishFixture({ viewport: { width: 390, height: 844 } }); t.after(f.close);
  const page = f.page;
  await page.locator('#aiStudyToggle').click();
  await page.waitForSelector('#aiStudySheet');
  const box = await page.evaluate(() => {
    const save = document.querySelector('.ai-study-sheet-save').getBoundingClientRect();
    const dock = document.getElementById('dockBar').getBoundingClientRect();
    const header = [...document.querySelectorAll('#aiChatRoot > .ai-chat-header > *')].map(n => n.getBoundingClientRect());
    return { saveBottom: save.bottom, dockTop: dock.top, headerRight: Math.max(...header.map(r => r.right)), width: innerWidth };
  });
  assert.ok(box.saveBottom <= box.dockTop, JSON.stringify(box));
  assert.ok(box.headerRight <= box.width, JSON.stringify(box));
  await page.locator('.ai-study-sheet-cancel').click();   // a real pointer click: fails if the dock covers the button
  await page.waitForSelector('#aiStudySheet', { state: 'detached' });
  assert.equal(await studyOn(page), true);
  await page.locator('.ai-study-leave').click();
  await page.waitForFunction(() => !document.getElementById('aiChatRoot').classList.contains('ai-study-mode'));
  assert.deepEqual(f.errors, []);
});

test('word passage: pick level and count, upload a word image, export the reply as a PDF, and sync to the account', async t => {
  const f = await aiPolishFixture({ viewport: { width: 390, height: 844 } }); t.after(f.close);
  const page = f.page;
  await page.locator('#aiStudyToggle').click();
  await page.waitForSelector('#aiStudySheet');
  await page.locator('.ai-study-sheet-cancel').click();
  await page.locator('[data-study-starter="words"]').click();
  await page.waitForSelector('#aiStudySheet');
  await page.locator('[data-study-choice="level"][data-value="ielts"]').click();
  await page.locator('[data-study-choice="count"][data-value="8"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-study-words="image"]').click();
  await chooser;
  assert.equal(await page.inputValue('#aiChatMsgInput'), '请提取图片里的所有单词，用它们写一篇雅思难度的阅读短文，并出 8 道阅读理解题。');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => aiPolish.streams.length === 1);
  assert.ok(await page.evaluate(() => !!aiPolish.streams[0].body.study));
  await page.evaluate(() => {
    aiPolishEmit({ type: 'meta', conversation_id: 'POLISH01' });
    aiPolishEmit({ type: 'content', text: '## Passage\n\nThe **harbour** was quiet.\n\n## 答案与解析\n\n1. A' });
    aiPolishEmit({ type: 'done' });
    aiPolish.streams.at(-1).controller.close();
  });
  const pdf = page.locator('.ai-msg.assistant .ai-msg-act-study-pdf');
  await pdf.waitFor();
  await pdf.click();
  await page.waitForFunction(() => aiPolish.calls.some(call => call.path.endsWith('/research/export')));
  const exported = await page.evaluate(() => aiPolish.calls.find(call => call.path.endsWith('/research/export')).body);
  assert.equal(exported.format, 'pdf'); assert.equal(exported.layout, 'study');
  assert.match(exported.title, /^学习笔记 \d{4}-\d{2}-\d{2}$/);
  assert.ok(exported.answer.includes('The **harbour** was quiet.'), 'the PDF gets the original markdown, not the rendered text');

  // 学习数据随账号保存：最近一次上传里有学习对话编号和单词短文设置。
  await page.waitForFunction(() => aiPolish.aiPrefs.study && aiPolish.aiPrefs.study.reading.count === 8);
  const synced = await page.evaluate(() => aiPolish.aiPrefs.study);
  assert.deepEqual(synced.reading, { level: 'ielts', count: 8 });
  assert.ok(synced.convs.includes('POLISH01')); assert.ok(synced.updated_at > 0);
  assert.deepEqual(f.errors, []);
});

test('a second device restores the learning profile and learning conversations from the account', async t => {
  const study = { profile: { exam: 'ielts', exam_other: '', target: '6.5', textbook: '剑桥雅思初级教程（新东方）', unit: '第 2 单元', style: 'concise', note: '' },
    convs: ['POLISH01'], reading: { level: 'cet6', count: 3 }, updated_at: Date.now() };
  const f = await aiPolishFixture({ viewport: { width: 1024, height: 768 }, aiPrefs: { study } }); t.after(f.close);
  const page = f.page;
  await page.waitForFunction(() => document.getElementById('aiChatRoot').classList.contains('ai-study-mode'));
  assert.equal(await page.locator('.ai-chat-header-title b').textContent(), '学习');
  assert.match(await page.locator('.ai-study-profile-value').textContent(), /雅思（目标 6\.5） · 剑桥雅思初级教程（新东方） · 第 2 单元/);
  await page.locator('[data-study-starter="words"]').click();
  assert.equal(await page.locator('[data-study-choice="level"][aria-checked="true"]').getAttribute('data-value'), 'cet6');
  assert.equal(await page.locator('[data-study-choice="count"][aria-checked="true"]').getAttribute('data-value'), '3');
  assert.equal(await page.evaluate(() => aiPolish.calls.some(call => call.method === 'PUT' && call.body.ai_prefs && call.body.ai_prefs.study)), false, 'restoring does not write back');
  assert.deepEqual(f.errors, []);
});
