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
