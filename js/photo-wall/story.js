(function(){
  'use strict';
  var current = null, epoch = 0, controller = null, social = null, expanded = false, mutationVersion = 0, storyAuthEpoch = 0, commentVersion = 0;
  var likeStates = new Map(), avatars = new Map(), commentAnimation = null, commentSequence = 0;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function el(id){ return document.getElementById(id); }
  function icon(path){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>'; }
  var heart=icon('<path d="M20.5 5.7a5.2 5.2 0 0 0-7.4 0L12 6.8l-1.1-1.1a5.2 5.2 0 0 0-7.4 7.4L12 21l8.5-7.9a5.2 5.2 0 0 0 0-7.4Z"/>');
  var bubble=icon('<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-9.5A8.5 8.5 0 0 1 10.5 4H13a8 8 0 0 1 8 7.5Z"/>');
  async function request(path,options){
    if(options.authEpoch!==authEpoch()||options.authOwner!==(window.currentUser||''))throw new Error('identity_changed');
    if(window.currentUser && window.xtjProtectedFetch) return window.xtjProtectedFetch(path,options);
    return fetch((window.API_BASE||location.origin)+path,options);
  }
  async function json(path,options){
    options=Object.assign({authOwner:current&&current._storyOwner||window.currentUser||'',authEpoch:storyAuthEpoch},options||{});
    var response=await request(path,options);var body=response ? await response.json().catch(function(){return{};}) : {};
    if(options.authEpoch!==authEpoch()||options.authOwner!==(window.currentUser||''))throw new Error('identity_changed');
    if(!response || !response.ok || body.ok!==true)throw new Error(body.error||'连接暂时不稳定，请重试');
    return body;
  }
  function authEpoch(){return window.__xtjGetAuthEpoch?window.__xtjGetAuthEpoch():0;}
  function valid(token,owner,id){return storyAuthEpoch===authEpoch() && token===epoch && current && String(current.cloudId)===String(id) && (window.currentUser||'')===owner;}
  function isWall(photo){return !!(photo && UUID.test(String(photo.cloudId||'')));}
  function ensure(){
    var root=el('photoPreviewOverlay'),info=root&&root.querySelector('.photo-preview-info');if(!info)return false;
    if(info.classList.contains('pp-story'))return true;
    new MutationObserver(function(){if(!root.classList.contains('active')){epoch++;if(controller)controller.abort();current=null;commentsVisible(false,true);}}).observe(root,{attributes:true,attributeFilter:['class']});
    info.classList.add('pp-story');
    var user=el('photoPreviewUser'),time=el('photoPreviewTime'),views=el('photoPreviewViews');
    var author=document.createElement('div');author.className='pp-story-author';
    var avatar=document.createElement('span');avatar.id='ppStoryAvatar';avatar.className='pp-story-avatar';
    var identity=document.createElement('div');identity.className='pp-story-identity';identity.appendChild(user);identity.appendChild(time);
    author.appendChild(avatar);author.appendChild(identity);info.prepend(author);
    var caption=document.createElement('p');caption.id='ppStoryCaption';caption.className='pp-story-caption';info.appendChild(caption);
    var more=document.createElement('button');more.type='button';more.id='ppCaptionMore';more.className='pp-caption-more';more.textContent='展开';more.hidden=true;more.onclick=function(){expanded=!expanded;caption.classList.toggle('expanded',expanded);more.textContent=expanded?'收起':'展开';more.setAttribute('aria-expanded',String(expanded));refreshCaptionOverflow();};info.appendChild(more);
    var stats=document.createElement('div');stats.className='pp-story-stats';stats.appendChild(views);
    var like=document.createElement('button');like.type='button';like.id='ppLikeBtn';like.setAttribute('aria-label','点赞照片');like.setAttribute('aria-pressed','false');like.innerHTML=heart+'<span id="ppLikeCount">0</span>';like.onclick=toggleLike;
    var comment=document.createElement('button');comment.type='button';comment.id='ppCommentBtn';comment.setAttribute('aria-label','查看照片评论');comment.innerHTML=bubble+'<span id="ppCommentCount">0</span>';comment.onclick=openComments;
    stats.appendChild(like);stats.appendChild(comment);info.appendChild(stats);
    var status=document.createElement('button');status.id='ppSocialStatus';status.className='pp-social-status';status.type='button';status.setAttribute('aria-live','polite');info.appendChild(status);
    var panel=document.createElement('section');panel.id='ppCommentsPanel';panel.className='pp-comments-panel';panel.hidden=true;panel.setAttribute('aria-label','照片评论');
    panel.innerHTML='<div class="pp-comments-head"><strong id="ppCommentsTitle">评论</strong><button type="button" id="ppCommentsClose" aria-label="关闭评论">×</button></div><div id="ppCommentsList" class="pp-comments-list"></div><button type="button" id="ppCommentsMore" hidden>加载更多评论</button><form id="ppCommentForm"><label class="sr-only" for="ppCommentInput">写评论</label><textarea id="ppCommentInput" maxlength="1000" rows="2" placeholder="说说你的想法…"></textarea><button type="submit" id="ppCommentSend">发送</button></form><div id="ppCommentError" role="status"></div>';
    root.appendChild(panel);
    if(window.ResizeObserver)new ResizeObserver(refreshCaptionOverflow).observe(caption);
    window.addEventListener('resize',refreshCaptionOverflow);
    el('ppCommentsClose').onclick=function(){commentsVisible(false);el('ppCommentBtn').focus();};el('ppCommentForm').onsubmit=sendComment;el('ppCommentsMore').onclick=moreComments;
    return true;
  }
  function refreshCaptionOverflow(){
    var caption=el('ppStoryCaption'),more=el('ppCaptionMore');if(!caption||!more)return;
    more.hidden=!expanded&&(caption.hidden||caption.scrollHeight<=caption.clientHeight+1);
  }
  function updateCounts(){
    if(!social)return;
    el('ppLikeCount').textContent=Number.isFinite(social.like_count)?social.like_count:'—';el('ppCommentCount').textContent=Number.isFinite(social.comment_count)?social.comment_count:'—';
    el('ppLikeBtn').setAttribute('aria-pressed',typeof social.liked==='boolean'?String(social.liked):'mixed');
    el('ppCommentsTitle').textContent=Number.isFinite(social.comment_count)?'评论 '+social.comment_count:'评论';
  }
  async function loadSocial(token,owner,id){
    var version=mutationVersion, commentsAtStart=commentVersion;
    try {
      var body=await json('/api/photo/'+encodeURIComponent(id)+'/social',{background:true,signal:controller.signal});
      if(!valid(token,owner,id)||commentsAtStart!==commentVersion)return;
      social=body;var saved=likeStates.get(owner+':'+id);if(saved&&saved.authEpoch===storyAuthEpoch&&(saved.pending||version!==mutationVersion)){social.liked=saved.desired;social.like_count=Math.max(0,saved.count+Number(saved.desired)-Number(saved.confirmed));}else{likeStates.set(owner+':'+id,{confirmed:!!body.liked,desired:!!body.liked,count:body.like_count||0,pending:false,authEpoch:storyAuthEpoch});}current.views=Math.max(Number(current.views)||0,body.views||0);el('photoPreviewViewsCount').textContent=current.views;updateCounts();el('ppSocialStatus').textContent='';el('ppLikeBtn').disabled=false;renderComments();
    }catch(error){if(!valid(token,owner,id)||error.name==='AbortError')return;el('ppSocialStatus').textContent='互动暂未加载，点击重试';el('ppSocialStatus').onclick=function(){loadSocial(epoch,window.currentUser||'',current.cloudId);};el('ppLikeBtn').disabled=!likeStates.has(owner+':'+id);}
  }
  function motion(){return !!(el('ppCommentsPanel').animate && document.documentElement.getAttribute('data-xtj-motion')!=='off' && !matchMedia('(prefers-reduced-motion: reduce)').matches);}
  function commentsVisible(show, immediate){
    var panel=el('ppCommentsPanel');if(!panel)return;
    var wasHidden=panel.hidden, sequence=++commentSequence;
    var from=wasHidden?{opacity:0,transform:'translateY(28px) scale(.98)'}:{opacity:getComputedStyle(panel).opacity,transform:getComputedStyle(panel).transform};
    if(commentAnimation){commentAnimation.cancel();commentAnimation=null;}
    if(immediate||!motion()){panel.hidden=!show;return;}
    if(!show&&wasHidden)return;
    panel.hidden=false;
    commentAnimation=panel.animate([from,show?{opacity:1,transform:'translateY(0) scale(1)'}:{opacity:0,transform:'translateY(28px) scale(.98)'}],{duration:show?240:190,easing:show?'cubic-bezier(.2,.8,.2,1)':'ease-in',fill:'both'});
    commentAnimation.finished.then(function(){if(sequence!==commentSequence)return;panel.hidden=!show;commentAnimation.cancel();commentAnimation=null;}).catch(function(){});
  }
  function preloadAvatar(name){
    if(!name)return Promise.resolve(null);
    var cached=avatars.get(name);if(cached&&Date.now()-cached.at<300000)return cached.promise;
    var entry={at:Date.now(),image:cached&&cached.image,promise:null};avatars.set(name,entry);
    entry.promise=(async function(){
      var url=window.xtjFetchAvatarUrl?await window.xtjFetchAvatarUrl(name):(await (await fetch((window.API_BASE||location.origin)+'/api/avatar/public/'+encodeURIComponent(name))).json()).avatar_url;
      if(!url){entry.at=Date.now()-285000;entry.image=null;return null;}
      url=String(url).trim();
      var inline=/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(url)&&url.length<=2*1024*1024;
      var parsed=new URL(url,location.origin);if(!inline&&parsed.protocol!=='https:'&&!(parsed.origin===location.origin&&/^https?:$/.test(parsed.protocol)))return null;
      var image=new Image();image.alt='';image.src=inline?url:parsed.href;
      await new Promise(function(resolve,reject){if(image.complete){image.naturalWidth?resolve():reject();return;}image.onload=resolve;image.onerror=reject;});
      if(image.decode)await image.decode().catch(function(){});
      if(avatars.get(name)!==entry)return (avatars.get(name)||{}).image||null;
      entry.image=image;return image;
    })().catch(function(){entry.at=0;return entry.image||null;});
    if(avatars.size>128){for(var key of avatars.keys()){if(key!==name){avatars.delete(key);break;}}}
    return entry.promise;
  }
  window.preloadPhotoStoryAvatars=function(photos){
    var names=Array.from(new Set((photos||[]).map(function(p){return p.username||p.user_name;}).filter(Boolean))).slice(0,40),next=0;
    // Bound independent public avatar work; never wait for it to open a photo.
    async function warm(){while(next<names.length)await preloadAvatar(names[next++]);}
    warm();warm();warm();
  };
  function showAvatar(photo){
    var name=String(photo.username||''),avatar=el('ppStoryAvatar'),cached=avatars.get(name);
    avatar.setAttribute('aria-label',name+'的头像');
    if(avatar.dataset.author!==name){avatar.dataset.author=name;avatar.textContent=name.slice(0,1)||'?';if(cached&&cached.image)avatar.replaceChildren(cached.image.cloneNode());}
    preloadAvatar(name).then(function(image){if(image&&current&&current.username===name&&avatar.dataset.author===name){var shown=avatar.querySelector('img');if(!shown||shown.src!==image.src)avatar.replaceChildren(image.cloneNode());}});
  }
  window.addEventListener('xtj:avatar-updated',function(event){
    var detail=event.detail||{},name=String(detail.username||'');if(!name)return;
    var cached=avatars.get(name);if(cached&&cached.image&&cached.image.src===detail.url)return;
    avatars.delete(name);if(current&&current.username===name)showAvatar(current);
  });
  window.renderPhotoStory=function(photo){
    if(!ensure())return;
    var key=function(p){return p&&(p.cloudId||p.id||p.imageUrl);};
    var same=current&&key(current)&&String(key(current))===String(key(photo))&&storyAuthEpoch===authEpoch()&&(current._storyOwner||'')===(window.currentUser||'');
    current=photo;current._storyOwner=window.currentUser||'';storyAuthEpoch=authEpoch();
    if(same){updateCounts();return;}
    var caption=typeof photo.caption==='string'?photo.caption:'';
    if(!caption&&photo.content){try{caption=JSON.parse(photo.content).caption||'';}catch(_){}}
    el('ppStoryCaption').textContent=caption;el('ppStoryCaption').hidden=!caption;
    el('ppCaptionMore').hidden=true;el('ppCaptionMore').setAttribute('aria-expanded','false');
    showAvatar(photo);
    epoch++;if(controller)controller.abort();controller=new AbortController();social=null;expanded=false;mutationVersion=0;commentVersion=0;el('ppStoryCaption').classList.remove('expanded');el('ppCaptionMore').textContent='展开';
    commentsVisible(false,true);el('ppCommentInput').value='';el('ppCommentInput').disabled=false;el('ppCommentSend').disabled=false;el('ppCommentError').textContent='';el('ppCommentsList').replaceChildren();
    el('ppLikeCount').textContent='—';el('ppCommentCount').textContent='—';el('ppLikeBtn').setAttribute('aria-pressed','mixed');el('ppLikeBtn').disabled=true;el('ppSocialStatus').textContent='';
    el('ppLikeBtn').hidden=el('ppCommentBtn').hidden=!isWall(photo);
    var token=epoch,owner=window.currentUser||'',id=photo.cloudId;
    if(isWall(photo)){var saved=likeStates.get(owner+':'+id);if(saved&&saved.pending&&saved.authEpoch!==storyAuthEpoch){likeStates.delete(owner+':'+id);saved=null;}if(saved){social={comments:[],liked:saved.desired,like_count:Math.max(0,saved.count+Number(saved.desired)-Number(saved.confirmed))};updateCounts();el('ppLikeBtn').disabled=false;}loadSocial(token,owner,id);}
    requestAnimationFrame(refreshCaptionOverflow);
  };
  function showLikeState(entry,owner,id){
    if(entry.authEpoch!=null&&entry.authEpoch!==authEpoch())return;
    if(!current || String(current.cloudId)!==String(id) || (window.currentUser||'')!==owner)return;
    social=social||{comments:[]};social.liked=entry.desired;
    social.like_count=Math.max(0,entry.count+Number(entry.desired)-Number(entry.confirmed));updateCounts();
  }
  function animateHeart(){
    var svg=el('ppLikeBtn').querySelector('svg');
    if(!svg||!svg.animate||document.documentElement.getAttribute('data-xtj-motion')==='off'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    if(svg._likeAnimation)svg._likeAnimation.cancel();
    svg._likeAnimation=svg.animate([{transform:'scale(1)'},{transform:'scale(1.22)',offset:.35},{transform:'scale(.96)',offset:.72},{transform:'scale(1)'}],{duration:280,easing:'ease-out'});
  }
  function toggleLike(){
    if(!current||!isWall(current)||el('ppLikeBtn').disabled)return;
    var owner=window.currentUser||'',id=current.cloudId;if(!owner){if(window.openAuthModal)window.openAuthModal('login');return;}
    var key=owner+':'+id,entry=likeStates.get(key);
    if(!entry){entry={confirmed:!!(social&&social.liked),desired:!!(social&&social.liked),count:(social&&social.like_count)||0,pending:false,authEpoch:storyAuthEpoch};likeStates.set(key,entry);}
    entry.desired=!entry.desired;mutationVersion++;showLikeState(entry,owner,id);animateHeart();el('ppSocialStatus').textContent='';
    if(!entry.pending)saveLike(entry,owner,id);
  }
  async function saveLike(entry,owner,id){
    var identityEpoch=authEpoch();entry.authEpoch=identityEpoch;entry.pending=true;
    try{
      while(entry.desired!==entry.confirmed){
        // Never send a queued intention using a different account's credentials.
        if(identityEpoch!==authEpoch()||(window.currentUser||'')!==owner){entry.desired=entry.confirmed;break;}
        var liked=entry.desired;
        var body=await json('/api/photo/'+id+'/like',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({liked:liked}),background:true,authOwner:owner,authEpoch:identityEpoch});
        entry.confirmed=!!body.liked;entry.count=Number(body.like_count)||0;showLikeState(entry,owner,id);
      }
    }catch(error){entry.desired=entry.confirmed;showLikeState(entry,owner,id);if(identityEpoch===authEpoch()&&current&&String(current.cloudId)===String(id)&&(window.currentUser||'')===owner)el('ppSocialStatus').textContent='点赞未保存，请重试';}
    finally{entry.pending=false;if(likeStates.size>256){for(var pair of likeStates){if(!pair[1].pending){likeStates.delete(pair[0]);break;}}}}
  }
  function renderComments(){
    var list=el('ppCommentsList');list.replaceChildren();
    if(!social){list.textContent='评论暂未加载，请关闭后重试';return;}

    social.comments.forEach(function(row){
      var item=document.createElement('article');item.className='pp-comment-row';var author=document.createElement('strong');author.textContent=row.user_name||'用户';var text=document.createElement('p');text.textContent=row.content||'';var time=document.createElement('time');time.textContent=new Date(row.created_at).toLocaleString('zh-CN');item.append(author,text,time);
      if(window.currentUser&&(row.user_name===window.currentUser||(window.currentUser==='xxz'&&window.isAdmin&&window.isAdmin()))){var remove=document.createElement('button');remove.type='button';remove.textContent='删除';remove.setAttribute('aria-label','删除自己的评论');remove.onclick=function(){deleteComment(row,remove);};item.appendChild(remove);}
      list.appendChild(item);
    });el('ppCommentsMore').hidden=!social.has_more;
  }
  function openComments(){if(!current||!isWall(current))return;commentsVisible(true);renderComments();if(!social)loadSocial(epoch,window.currentUser||'',current.cloudId);}
  async function moreComments(){
    if(!social||!social.next_cursor)return;var token=epoch,owner=window.currentUser||'',id=current.cloudId,version=commentVersion;var button=el('ppCommentsMore');button.disabled=true;
    try{var body=await json('/api/photo/'+id+'/social?before='+encodeURIComponent(social.next_cursor),{background:true,signal:controller.signal});if(!valid(token,owner,id)||version!==commentVersion)return;var rows=social.comments.concat(body.comments),seen=new Set();social.comments=rows.filter(function(r){if(seen.has(r.id))return false;seen.add(r.id);return true;});social.has_more=body.has_more;social.next_cursor=body.next_cursor;renderComments();}
    catch(error){if(valid(token,owner,id))el('ppCommentError').textContent=error.message;}finally{if(token===epoch)button.disabled=false;}
  }
  async function sendComment(event){
    event.preventDefault();if(!current||!isWall(current)||el('ppCommentSend').disabled)return;
    var input=el('ppCommentInput'),content=input.value.trim();if(!content)return;
    var token=epoch,owner=window.currentUser||'',id=current.cloudId;if(!owner){if(window.openAuthModal)window.openAuthModal('login');return;}
    mutationVersion++;commentVersion++;input.disabled=true;el('ppCommentSend').disabled=true;
    try{var body=await json('/api/photo/'+id+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:content})});if(!valid(token,owner,id))return;
      social=social||{comments:[]};social.comments.unshift(body.comment);if(Number.isFinite(social.comment_count))social.comment_count++;input.value='';el('ppCommentError').textContent='';updateCounts();renderComments();loadSocial(token,owner,id);}
    catch(error){if(valid(token,owner,id)){el('ppCommentError').textContent=error.message;loadSocial(token,owner,id);}}
    finally{if(valid(token,owner,id)){input.disabled=false;el('ppCommentSend').disabled=false;}}
  }
  async function deleteComment(row,button){
    if(button.disabled)return;commentVersion++;var token=epoch,owner=window.currentUser||'',id=current.cloudId;button.disabled=true;
    try{await json('/api/post/comment/'+encodeURIComponent(row.id),{method:'DELETE'});if(!valid(token,owner,id))return;social.comments=social.comments.filter(function(r){return r.id!==row.id;});if(Number.isFinite(social.comment_count))social.comment_count=Math.max(0,social.comment_count-1);updateCounts();renderComments();loadSocial(token,owner,id);}
    catch(error){if(valid(token,owner,id)){el('ppCommentError').textContent=error.message;button.disabled=false;loadSocial(token,owner,id);}}
  }
  window.preloadPhotoStoryAvatars(window.photoWallData||[]);
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&el('ppCommentsPanel')&&!el('ppCommentsPanel').hidden){event.stopImmediatePropagation();event.preventDefault();el('ppCommentsClose').click();}},true);
})();
