'use strict';
const { TIMESTAMP } = require('./post-interactions');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid() { return Object.assign(new Error('帖子搜索参数无效'), { status:400, code:'invalid_feed_search' }); }
async function readFeedSearch(db, query, actor, fields) {
  const q=String(query.q||'').trim(), author=String(query.author||'').trim(), visibility=query.visibility||'all';
  const from=query.from||null,to=query.to||null,before=query.cursor_created_at||null,id=query.cursor_id||null;
  const timezone=String(query.timezone||'UTC');
  if(!q||q.length>200||author.length>100||!['all','public','private'].includes(visibility)||timezone.length>100||
    [from,to,before].some(value=>value&&(!TIMESTAMP.test(value)||!Number.isFinite(Date.parse(value))))||
    (from&&to&&Date.parse(from)>=Date.parse(to))||!!before!==!!id||(id&&!UUID.test(id)))throw invalid();
  try { new Intl.DateTimeFormat('en',{timeZone:timezone}); } catch(_) { throw invalid(); }
  const limit=Math.min(50,Math.max(1,parseInt(query.limit,10)||20));
  const result=await db.rpc('xtj_search_feed',{p_query:q,p_actor:actor||'',p_author:author,p_visibility:visibility,
    p_only_mine:query.only_mine==='true',p_from:from,p_to:to,p_before_at:before,p_before_id:id,p_limit:limit+1,p_timezone:timezone}).select(fields);
  if(result.error||!Array.isArray(result.data))throw Object.assign(new Error('帖子搜索暂不可用，请重试'),{status:503,code:'feed_search_unavailable',retryable:true});
  const posts=result.data.slice(0,limit),last=posts.at(-1);
  return {posts,endReached:result.data.length<=limit,nextCursor:last?{created_at:last.created_at,id:last.id}:null};
}
module.exports={readFeedSearch};
