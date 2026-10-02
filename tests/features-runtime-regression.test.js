'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const FEATURES_SOURCE = fs.readFileSync(path.join(ROOT, 'js/features.js'), 'utf8');

class FakeText {
  constructor(value) {
    this.nodeType = 3;
    this.parentNode = null;
    this.assignments = 0;
    this._nodeValue = String(value);
  }

  get nodeValue() { return this._nodeValue; }
  set nodeValue(value) {
    this.assignments += 1;
    this._nodeValue = String(value);
  }
}

class FakeElement {
  constructor(tagName, attrs) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.parentNode = null;
    this.childNodes = [];
    this.attributes = Object.assign({}, attrs || {});
    this.attributeWrites = 0;
  }

  appendChild(node) {
    if (node.parentNode) {
      const oldChildren = node.parentNode.childNodes;
      const oldIndex = oldChildren.indexOf(node);
      if (oldIndex !== -1) oldChildren.splice(oldIndex, 1);
    }
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
  getAttribute(name) { return this.hasAttribute(name) ? this.attributes[name] : null; }
  setAttribute(name, value) {
    this.attributeWrites += 1;
    this.attributes[name] = String(value);
  }
  removeAttribute(name) {
    if (this.hasAttribute(name)) {
      this.attributeWrites += 1;
      delete this.attributes[name];
    }
  }
  addEventListener() {}

  querySelectorAll(selector) {
    assert.equal(selector, '*');
    const found = [];
    const visit = (node) => {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 1) {
          found.push(child);
          visit(child);
        }
      }
    };
    visit(this);
    return found;
  }
}

function makeRuntime(prepareBody) {
  const frames = [];
  const body = new FakeElement('body');
  let mutationObserver;
  const document = {
    body,
    readyState: 'complete',
    getElementById() { return null; },
    addEventListener() {},
    createTreeWalker(root, whatToShow) {
      assert.equal(whatToShow, 4, 'features.js should walk text nodes only');
      const textNodes = [];
      const visit = (node) => {
        for (const child of node.childNodes || []) {
          if (child.nodeType === 3) textNodes.push(child);
          else if (child.nodeType === 1) visit(child);
        }
      };
      visit(root);
      let index = 0;
      return { nextNode() { return textNodes[index++] || null; } };
    }
  };
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.options = null;
      this.target = null;
      mutationObserver = this;
    }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() {}
  }
  const window = {
    addEventListener() {},
    showToast() {}
  };
  const context = {
    window,
    document,
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame(callback) { frames.push(callback); },
    WeakSet,
    Object,
    Array,
    String,
    RegExp
  };
  if (typeof prepareBody === 'function') prepareBody(body);
  vm.runInNewContext(FEATURES_SOURCE, context, { filename: 'js/features.js' });

  function flushFrames() {
    let turns = 0;
    while (frames.length) {
      assert.ok(++turns < 20, 'repair scheduling should settle instead of looping');
      frames.shift()();
    }
  }

  return { body, frames, observer: mutationObserver, flushFrames };
}

function addProtectedSample(parent, tag) {
  const literal = new FakeText('鍙戦€');
  const nested = new FakeElement('span', { title: '鍔犺浇' });
  nested.appendChild(literal);
  const protectedElement = new FakeElement(tag, { 'aria-label': '鍙戦€' });
  protectedElement.appendChild(nested);
  parent.appendChild(protectedElement);
  return { protectedElement, nested, literal };
}

test('features repairs initial and dynamic UI text and allowed labels', () => {
  const heading = new FakeElement('h2', { 'data-xtj-legacy-text': '' });
  const headingText = new FakeText('鍏ㄩ儴甯栧瓙');
  heading.appendChild(headingText);
  const button = new FakeElement('button', { title: '鍙戦€', 'data-xtj-legacy-text': '' });
  const runtime = makeRuntime((body) => {
    body.appendChild(heading);
    body.appendChild(button);
  });

  // Initial DOM scan repairs readable UI text and explicitly supported attributes.
  runtime.flushFrames();
  assert.equal(headingText.nodeValue, '全部帖子');
  assert.equal(button.getAttribute('title'), '发送');

  const dynamic = new FakeElement('div', { 'data-xtj-legacy-text': '' });
  const dynamicText = new FakeText('鍔犺浇');
  dynamic.appendChild(dynamicText);
  runtime.body.appendChild(dynamic);
  runtime.observer.callback([{ type: 'childList', addedNodes: [dynamic] }]);
  runtime.flushFrames();
  assert.equal(dynamicText.nodeValue, '加载');

  const changedText = new FakeText('鍙戦€');
  dynamic.appendChild(changedText);
  runtime.observer.callback([{ type: 'characterData', target: changedText }]);
  runtime.flushFrames();
  assert.equal(changedText.nodeValue, '发送');

  button.setAttribute('aria-label', '鍙戦€');
  runtime.observer.callback([{ type: 'attributes', target: button, attributeName: 'aria-label' }]);
  runtime.flushFrames();
  assert.equal(button.getAttribute('aria-label'), '发送');

  assert.equal(runtime.observer.target, runtime.body);
  assert.equal(runtime.observer.options.childList, true);
  assert.equal(runtime.observer.options.characterData, true);
  assert.equal(runtime.observer.options.attributes, true);
  assert.equal(runtime.observer.options.subtree, true);
  assert.ok(runtime.observer.options.attributeFilter.includes('placeholder'));
});

test('features leaves literal text alone in protected elements and their descendants', () => {
  const shell = new FakeElement('div');
  const tags = ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'PRE', 'CODE', 'TEXTAREA', 'INPUT'];
  const samples = tags.map((tag) => addProtectedSample(shell, tag));
  const runtime = makeRuntime((body) => body.appendChild(shell));

  runtime.flushFrames();
  for (const sample of samples) {
    assert.equal(sample.literal.nodeValue, '鍙戦€', sample.protectedElement.tagName + ' text must stay literal');
    assert.equal(sample.nested.getAttribute('title'), '鍔犺浇', sample.protectedElement.tagName + ' descendant attributes must stay literal');
    assert.equal(sample.protectedElement.getAttribute('aria-label'), '鍙戦€', sample.protectedElement.tagName + ' attributes must stay literal');
  }

  // Also cover a text node queued while visible, then moved under a code sample
  // before the animation-frame repair flush.
  const movable = new FakeElement('span', { 'data-xtj-legacy-text': '' });
  const movableText = new FakeText('鍙戦€');
  movable.appendChild(movableText);
  runtime.body.appendChild(movable);
  runtime.observer.callback([{ type: 'childList', addedNodes: [movable] }]);
  assert.equal(runtime.frames.length, 1);
  samples[4].protectedElement.appendChild(movable);
  runtime.flushFrames();
  assert.equal(movableText.nodeValue, '鍙戦€', 'queued text must be rechecked after moving into PRE');
});

test('features observer does not reschedule repairs for its own corrected mutations', () => {
  const label = new FakeElement('button', { title: '鍙戦€', 'data-xtj-legacy-text': '' });
  const text = new FakeText('鍙戦€');
  label.appendChild(text);
  const runtime = makeRuntime((body) => body.appendChild(label));
  runtime.flushFrames();
  assert.equal(text.nodeValue, '发送');
  assert.equal(label.getAttribute('title'), '发送');
  const textWrites = text.assignments;
  const attributeWrites = label.attributeWrites;

  runtime.observer.callback([
    { type: 'characterData', target: text },
    { type: 'attributes', target: label, attributeName: 'title' },
    { type: 'attributes', target: label, attributeName: 'title' }
  ]);
  assert.equal(runtime.frames.length, 0, 'already repaired values should not schedule a frame');
  runtime.flushFrames();
  assert.equal(text.assignments, textWrites, 'corrected text must not be assigned repeatedly');
  assert.equal(label.attributeWrites, attributeWrites, 'corrected attributes must not be assigned repeatedly');
});

test('ordinary published user text and labels remain literal, including dynamic updates', () => {
  const user = new FakeElement('div', { title: '鍙戦€' }), text = new FakeText('鍒嗕韩 鍔犺浇');
  user.appendChild(text); const runtime = makeRuntime(body => body.appendChild(user)); runtime.flushFrames();
  assert.equal(text.nodeValue, '鍒嗕韩 鍔犺浇'); assert.equal(user.getAttribute('title'), '鍙戦€');
  text.nodeValue = '鍙戦€'; runtime.observer.callback([{ type:'characterData', target:text }]); runtime.flushFrames();
  assert.equal(text.nodeValue, '鍙戦€');
});

test('empty toast feedback is suppressed while user-derived literals and whitespace are preserved', () => {
  const calls = [], sandbox = { window: { showToast: (...args) => calls.push(args) }, document: { readyState:'loading', addEventListener() {} } };
  const from = FEATURES_SOURCE.indexOf('  function patchToast()'), to = FEATURES_SOURCE.indexOf('  function patchChat()', from);
  vm.runInNewContext(FEATURES_SOURCE.slice(from, to) + '; patchToast();', sandbox);
  sandbox.window.showToast(''); sandbox.window.showToast('   '); sandbox.window.showToast(' 鍔犺浇 ', 'info');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], ' 鍔犺浇 '); assert.equal(calls[0][1], 'info');
});
