'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const media = require('../js/post-media');
const { validatePostAttachments, loadPostAttachments, createPostWithAttachments } = require('../render-api/post-attachments');
const origin = 'https://project.supabase.co';
const picture = n => ({ media_url: origin + '/storage/v1/object/public/uploads/posts/photo-' + n + '.png', storage_path: 'posts/photo-' + n + '.png', upload_id: 'upload-id-' + n, position: n, media_type: 'image', width: 400, height: 300, file_size: 100 });
const file = (n, type = 'image/png') => ({ name: 'file-' + n + '.png', type, size: 100 });
const source = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');
const detail = fs.readFileSync('js/core-parts/06-chat-and-nav.js', 'utf8');
function between(source, start, end) { const a = source.indexOf(start), b = source.indexOf(end, a + start.length); assert.ok(a >= 0 && b > a); return source.slice(a, b); }
function renderer() {
  const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ctx = { window: { XtjPostMedia: media, safeParseDate: value => new Date(value) }, normalizePost: p => p,
    escapeHtml: esc, safeJsStr: v => String(v).replace(/'/g, "\\'"), sanitizeUrl: url => /^https?:\/\//.test(url) ? url : '', canDeletePost: p => p.user_name === 'alice',
    currentUser: 'alice', isAdmin: () => false, formatRelativeTime: () => '刚刚', looksLikeSystemTelemetry: () => false,
    isPostLikedByCurrentUser: () => false, buildPostContentHtml: esc, getAvatarHtml: () => '<span class="avatar">A</span>',
    formatPostTime: () => '今天', buildPostBadges: () => '', buildPostLocationHtml: () => '', buildPostStatsLine: (p,l,c) => `浏览 ${p.views||0}｜点赞 ${l}｜评论 ${c}`,
    buildPostActionHtml: () => '<button>评论</button><button>点赞</button>' };
  vm.runInNewContext(between(source, '            function getPostMediaItems(', '            // A malformed legacy record'), ctx);
  vm.runInNewContext(between(detail, '            function statPostDetailMarkup(', '            renderPostDetail ='), ctx);
  return ctx;
}
for (const count of [1,2,3,4,6,9,15,18]) {
  test(`${count} images: validate original order; Feed caps at 9 and Detail renders every image`, () => {
    const attachments = validatePostAttachments(Array.from({length:count},(_,n)=>picture(n)), origin);
    assert.deepEqual(attachments.map(a=>a.position), Array.from({length:count},(_,n)=>n));
    media.validateSelection(Array.from({length:count},(_,n)=>file(n)));
    const ctx = renderer(), post = { id:'post', user_name:'alice', created_at:'2026-10-03', media_type:count>1?'album':'image', media_url:attachments[0].media_url, media_items:attachments, content:'正文' };
    const feed = ctx.renderPostCard(post, {}, {}, {}), full = ctx.statPostDetailMarkup(post, [], []);
    assert.equal((feed.match(/<img /g)||[]).length, Math.min(count,9)); assert.equal((full.match(/<img /g)||[]).length, count);
    assert.match(feed, new RegExp('--post-grid-columns:' + media.gridColumns(count)));
    assert.equal(feed.includes('post-media-overflow'), count>9); if(count>9)assert.match(feed,new RegExp('>\\+'+(count-9)+'<'));
    assert.ok(full.indexOf('post-detail-content') < full.indexOf('post-media-grid'));
    assert.match(feed,/width="400" height="300"/);assert.match(feed,/loading="lazy" decoding="async"/);
  });
}
test('text/legacy image/photo/album and single video/audio remain renderable without attachment records', () => {
  const ctx=renderer();assert.deepEqual(media.getPostMediaItems({content:'text'}),[]);
  for(const type of ['image','photo','album']) { const post={id:'p',media_url:picture(0).media_url,media_type:type};assert.equal(media.getPostMediaItems(post)[0].media_type,'image');assert.equal((ctx.renderPostMediaGrid(post).match(/<img /g)||[]).length,1); }
  for(const type of ['video','audio']) {media.validateSelection([file(0,type+'/mp4')]);assert.match(ctx.renderPostMediaGrid({media_type:type,media_url:picture(0).media_url}), new RegExp('<'+type));}
  assert.equal(ctx.renderPostMediaGrid({media_type:'image',media_url:'javascript:alert(1)'}),'');
});
test('19 images, mixed media, multiple videos/audio, oversize and active file types are rejected', () => {
  assert.throws(()=>media.validateSelection(Array.from({length:19},(_,n)=>file(n))));
  assert.throws(()=>validatePostAttachments(Array.from({length:19},(_,n)=>picture(n)),origin));
  for(const list of [[file(0),file(1,'video/mp4')],[file(0),file(1,'audio/mpeg')],[file(0,'video/mp4'),file(1,'video/mp4')],[file(0,'audio/mpeg'),file(1,'audio/mpeg')]])assert.throws(()=>media.validateSelection(list));
  assert.throws(()=>media.validateSelection([{...file(0),size:media.MAX_POST_FILE_BYTES+1}]));assert.throws(()=>media.validateSelection([{name:'bad.svg',type:'image/svg+xml',size:10}]));
  assert.throws(()=>validatePostAttachments([picture(0),picture(0)],origin));
  assert.throws(()=>validatePostAttachments([{...picture(0),storage_path:'posts/other.png'}],origin));
  assert.throws(()=>validatePostAttachments([{...picture(0),width:20001}],origin));
});
test('normalization sorts without mutating source and keeps legacy cover fallback', () => {
  const list=[picture(2),picture(0),picture(1)], post={media_url:'cover',media_type:'album',media_items:list};
  assert.deepEqual(media.getPostMediaItems(post).map(a=>a.position),[0,1,2]);assert.deepEqual(list.map(a=>a.position),[2,0,1]);
  assert.equal(media.getPostMediaItems({media_url:'cover',media_type:'album',media_items:[]})[0].media_url,'cover');
});
test('Feed attachment loading uses a single batch restricted to already-visible IDs and excludes storage paths', async () => {
  const calls=[]; const db={from(table){assert.equal(table,'post_attachments');const q={select(fields){assert.ok(!fields.includes('storage_path'));return q;},in(k,ids){calls.push(ids);return q;},order(){return Promise.resolve({data:[{...picture(1),post_id:'b'},{...picture(0),post_id:'a'}]});}};return q;}};
  const result=await loadPostAttachments(db,[{id:'a',media_type:'album'},{id:'b',media_type:'image'},{id:'c',media_url:'old'}]);
  assert.deepEqual(calls,[['a','b','c']]);assert.equal(result[0].media_items[0].position,0);assert.equal(result[2].media_items[0].media_url,'old');
  await loadPostAttachments(db,[]);assert.equal(calls.length,1);
  await assert.rejects(loadPostAttachments({from(){return{select(){return this},in(){return this},order(){return{error:Error('offline')}}}}},[{id:'a'}]),e=>e.code==='attachments_unavailable');
});
test('create invokes one atomic RPC and never downgrades to direct inserts on failure', async () => {
  const calls=[],db={rpc:async(name,args)=>{calls.push([name,args]);return{data:{ok:true,post:{id:'created'},attachments:[picture(0)]}}}};
  const result=await createPostWithAttachments(db,'alice',{user_name:'alice'},[picture(0)]);assert.equal(result.data.media_items.length,1);
  assert.equal(calls[0][0],'create_post_with_attachments');assert.equal(calls[0][1].p_max_images,media.MAX_POST_IMAGES);
  assert.ok((await createPostWithAttachments({rpc:async()=>({error:Error('offline')})},'a',{},[])).error);
});
test('upload failure stops scheduling and drains in-flight uploads before cleanup; concurrency stays bounded', async () => {
  let active=0,peak=0;const settled=[],started=[];
  await assert.rejects(media.mapUploads(Array.from({length:18},(_,n)=>n),async n=>{started.push(n);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,n===1?1:10));active--;settled.push(n);if(n===1)throw Error('second image failed');return n;},3));
  assert.equal(active,0);assert.equal(peak,3);assert.deepEqual(started,[0,1,2]);assert.deepEqual(new Set(settled),new Set(started));
  const result=await media.mapUploads([0,1,2,3,4],async n=>{await new Promise(r=>setTimeout(r,5-n));return n;},3);assert.deepEqual(result,[0,1,2,3,4]);
});
test('Feed has at most 3 preview comments while Detail retains replies, AI comments and orphan/deep/cyclic content', () => {
  const comments=Array.from({length:10},(_,n)=>({id:String(n),content:'comment-'+n,user_name:n===2?'cat_ai':'bob',generated_by_ai:n===2,parent_comment_id:n?String(n-1):null}));
  const ctx=renderer(),post={id:'post',user_name:'alice',content:'x',created_at:'2026-10-03'};
  const feed=ctx.renderPostCard(post,{post:comments},{},{}), full=ctx.statPostDetailMarkup(post,[],comments);
  assert.equal((feed.match(/data-comment-id=/g)||[]).length,3);assert.match(feed,/查看全部 10 条评论/);
  assert.equal((full.match(/data-comment-id=/g)||[]).length,10);assert.match(full,/cat-ai-comment/);assert.match(full,/comment-replies/);
  assert.equal((ctx.buildPostCommentsHtml(post,[{...comments[0],parent_comment_id:'1'},{...comments[1],parent_comment_id:'0'}],{detail:true}).match(/data-comment-id=/g)||[]).length,2);
});
module.exports = { picture, renderer };

test('background metadata snapshots retain all attachments rather than replacing an album with its cover',async()=>{
  const items=Array.from({length:15},(_,n)=>picture(n));const ctx={window:{},feedAllPosts:[{id:'post',media_items:items}],sb:{from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:'post',media_url:items[0].media_url,media_type:'album',ip_region_text:'福建'}})})}};
  vm.runInNewContext(between(source,'            async function fetchPostSnapshot(', '            async function updatePostRecord('),ctx);
  assert.equal((await ctx.fetchPostSnapshot('post')).media_items.length,15);
});
