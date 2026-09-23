const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const profileSource = fs.readFileSync('js/core-parts/03-profile-report-ai.js', 'utf8');
const shellSource = fs.readFileSync('js/desktop-shell.js', 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createProfileActivityHarness() {
  const stateStart = profileSource.indexOf('            var profileActivityState = {');
  const renderStart = profileSource.indexOf('            function renderProfileTotals()', stateStart);
  const loadStart = profileSource.indexOf('            async function loadProfileActivity(forceRefresh)', renderStart);
  const loadEnd = profileSource.indexOf('            window.toggleProfileActivity =', loadStart);
  assert.ok(stateStart >= 0 && renderStart > stateStart && loadStart > renderStart && loadEnd > loadStart);

  const pending = Object.create(null);
  const sandbox = {
    currentUser: 'alice',
    profileRenderCount: 0,
    document: { getElementById: (id) => id === 'panelProfile' ? {} : null },
    window: {},
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    console,
    Date,
    Promise,
    Array,
    Object,
    JSON,
    encodeURIComponent,
    AUTH_MARKER: '__auth__',
    DM_MARKER: '__dm__',
    REPORT_MARKER: '__report__',
    ADMIN_META_MARKER: '__admin_meta__',
    normalizePost: (post) => post,
    feedAllPosts: [],
    cloneProfileLikes: (items) => Array.isArray(items) ? items.slice() : [],
    sb: {
      from() {
        const query = {
          username: '',
          select() { return this; },
          eq(key, value) { if (key === 'user_name') this.username = value; return this; },
          neq() { return this; },
          order() { return this; },
          limit() { return this; },
          then(resolve, reject) {
            const result = this.username
              ? { data: [], count: 0 }
              : { data: [] };
            return Promise.resolve(result).then(resolve, reject);
          }
        };
        return query;
      }
    },
    xtjProtectedFetch(url) {
      const user = decodeURIComponent(url.split('/user/')[1].split('?')[0]);
      if (!pending[user]) pending[user] = deferred();
      return pending[user].promise;
    }
  };
  sandbox.window.xtjProtectedFetch = sandbox.xtjProtectedFetch;
  sandbox.renderProfileActivity = () => { sandbox.profileRenderCount++; };
  vm.createContext(sandbox);
  const source = profileSource.slice(stateStart, renderStart)
    + '\n' + profileSource.slice(loadStart, loadEnd)
    + '\nglobalThis.profileStateForTest = profileActivityState;';
  vm.runInContext(source, sandbox, { filename: 'profile-activity-test-harness.js' });
  return { sandbox, pending };
}

function apiResponse(user) {
  return {
    ok: true,
    json: async () => ({ ok: true, data: [{ id: user + '-like', post_id: null }], count: 1 })
  };
}

test('profile activity drops old account responses and permits new account load while loading', async () => {
  const { sandbox, pending } = createProfileActivityHarness();

  const aliceLoad = sandbox.loadProfileActivity(true);
  assert.ok(pending.alice, 'first account request should start');

  sandbox.currentUser = 'bob';
  const bobLoad = sandbox.loadProfileActivity(true);
  assert.ok(pending.bob, 'account switch should start a new request without waiting for Alice');

  pending.bob.resolve(apiResponse('bob'));
  await bobLoad;
  assert.equal(sandbox.profileStateForTest.loadedUser, 'bob');
  assert.equal(sandbox.profileStateForTest.likes[0].id, 'bob-like');

  pending.alice.resolve(apiResponse('alice'));
  await aliceLoad;
  assert.equal(sandbox.profileStateForTest.loadedUser, 'bob');
  assert.equal(sandbox.profileStateForTest.likes[0].id, 'bob-like');
  assert.equal(sandbox.profileStateForTest.loading, false);
});

test('logout clears profile activity and invalidates an in-flight account response', async () => {
  const { sandbox, pending } = createProfileActivityHarness();

  const aliceLoad = sandbox.loadProfileActivity(true);
  sandbox.currentUser = '';
  await sandbox.loadProfileActivity(true);
  assert.equal(sandbox.profileStateForTest.loading, false);
  assert.equal(sandbox.profileStateForTest.loadedUser, '');
  assert.deepEqual(Array.from(sandbox.profileStateForTest.likes), []);

  pending.alice.resolve(apiResponse('alice'));
  await aliceLoad;
  assert.equal(sandbox.profileStateForTest.loadedUser, '');
  assert.deepEqual(Array.from(sandbox.profileStateForTest.likes), []);
});

test('desktop chat refresh contains synchronous syncContacts and syncChatBadge failures', async () => {
  const refreshStart = shellSource.indexOf('  var _refreshLocks = {};');
  const refreshEnd = shellSource.indexOf('  function init() {', refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);

  const calls = [];
  const sandbox = {
    window: {
      syncContacts() { calls.push('contacts'); throw new Error('syncContacts sync failure'); },
      syncChatBadge() { calls.push('badge'); throw new Error('syncChatBadge sync failure'); }
    },
    Promise,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(shellSource.slice(refreshStart, refreshEnd)
    + '\nglobalThis.performRefreshForTest = performRefresh;', sandbox, { filename: 'desktop-refresh-test-harness.js' });

  await assert.doesNotReject(sandbox.performRefreshForTest('chat'));
  assert.deepEqual(calls, ['contacts', 'badge']);
});
