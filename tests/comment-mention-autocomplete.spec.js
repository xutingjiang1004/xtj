const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const core = fs.readFileSync('js/core.js', 'utf8');
const css = fs.readFileSync('css/style.css', 'utf8');

test('mention dropdown exists in comment input', () => {
  assert.match(core, /mention-dropdown/);
  assert.match(core, /showMentionDropdown/);
  assert.match(core, /insertMentionAtCursor/);
  assert.match(core, /closeMentionDropdown/);
});

test('@ triggers mention autocomplete', () => {
  assert.match(core, /var atPos = -1/);
  assert.match(core, /text\[i\] === '@' \|\| text\[i\] === '＠'/);
  assert.match(core, /i === 0 \|\| text\[i - 1\] === ' ' \|\| text\[i - 1\] === '\\n'/);
});

test('mention shows 小猫 candidate with AI badge', () => {
  assert.match(core, /name="小猫"/);
  assert.match(core, /AI<\/span>/);
  assert.match(core, /犀利毒舌回复/);
  assert.match(core, /mention-avatar.*🐱/);
});

test('keyboard navigation: ArrowDown, ArrowUp, Enter, Tab, Escape', () => {
  assert.match(core, /ArrowDown/);
  assert.match(core, /ArrowUp/);
  assert.match(core, /updateMentionActive/);
  assert.match(core, /key === 'Escape'/);
  assert.match(core, /key === 'Tab'/);
});

test('click outside closes dropdown', () => {
  assert.match(core, /e\.target !== inp && !mentionDropdown\.contains/);
});

test('insert mention at cursor position', () => {
  assert.match(core, /function insertMentionAtCursor/);
  assert.match(core, /inp\.setSelectionRange/);
  assert.match(core, /mentionDropdown/);
});

test('mention uses event delegation, not per-input binding', () => {
  assert.match(core, /inp\.addEventListener\('input'/);
  assert.match(core, /inp\.addEventListener\('keydown'/);
});

test('mention dropdown has aria attributes', () => {
  assert.match(core, /role=.combobox/);
  assert.match(core, /role=.listbox/);
  assert.match(core, /aria-expanded/);
  assert.match(core, /aria-activedescendant/);
});

test('mention CSS styles exist', () => {
  assert.match(css, /\.mention-dropdown/);
  assert.match(css, /\.mention-item/);
  assert.match(css, /\.mention-badge/);
  assert.match(css, /\.mention-desc/);
});

test('touch support for iPhone/iPad', () => {
  assert.match(core, /touchend/);
});

test('mention box closes on post close or re-render', () => {
  assert.match(core, /closeMentionDropdown/);
});

test('full-width @ (＠) triggers mention', () => {
  assert.match(core, /＠/);
});