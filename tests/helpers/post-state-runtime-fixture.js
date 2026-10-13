'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../js/core-parts/04-posts-interactions.js'), 'utf8');

function installFeedMutationRuntime(context) {
  const start = source.indexOf('            function markFeedStateChanged()');
  const end = source.indexOf('            function syncPostInfoCache(', start);
  if (start < 0 || end < start) throw new Error('Missing feed mutation runtime');
  Object.assign(context, {
    feedStateVersion: 0, feedInteractionMutationVersion: 0,
    feedVisiblePostsCache: ['cached'], feedMapsCache: { cached: true }
  });
  if (!context.feedAllPosts) context.feedAllPosts = [];
  if (!context.profileActivityState) context.profileActivityState = { comments: [], totals: {} };
  if (!context.deletedPostCommentIds) context.deletedPostCommentIds = new Set();
  if (!context.engagementRefreshTimers) context.engagementRefreshTimers = new Map();
  vm.runInNewContext(source.slice(start, end), context);
}
module.exports = { installFeedMutationRuntime };
