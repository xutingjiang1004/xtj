(function(global){
  'use strict';
  var serial=0;
  function messageId(message,index){var raw=message && (message.client_request_id||message.request_id||message.id);return raw?JSON.stringify([String(message.role||''),String(raw)]):'temporary:'+index;}
  function estimateHeight(message,width){var text=String(message&&message.content||message&&message.answer||''),chars=Math.max(18,Math.floor((Math.max(240,width||360)-82)/8));var lines=text.split('\n').reduce(function(sum,line){return sum+Math.max(1,Math.ceil(line.length/chars));},0);return Math.max(76,Math.min(9000,lines*24+58));}
  function positionKey(owner,key){return 'xtj_ai_reading_'+encodeURIComponent(JSON.stringify([String(owner||''),String(key||'')]));}
  function create(options){
    options=options||{};var doc=global.document,container=options.container,scrollBox=options.scrollBox||container;
    if(!doc||!container||!scrollBox||!options.owner||!options.key)throw Error('阅读工具需要账号、会话和消息区域');
    var disposed=false,epoch=0,life=new AbortController(),items=new Map(),reports=new Map(),reportSerial=0,frame=0,rememberTimer=0,restoreFrame=0,restoreResolve=null,observer=null;
    var storageKey=positionKey(options.owner,options.key),instance=++serial,viewportTargets=[],originalScrollTabIndex=scrollBox.getAttribute('tabindex');
    if(originalScrollTabIndex===null)scrollBox.tabIndex=0;
    function current(){return !disposed && (typeof options.current!=='function'||options.current());}
    function visible(){return current()&&scrollBox.isConnected&&scrollBox.getClientRects().length&&scrollBox.clientHeight>0;}
    function idOf(node,message,index){return messageId(message,index==null?items.size:index);}
    function cleanupSubtree(node){if(!node)return;[node].concat(Array.from(node.querySelectorAll?node.querySelectorAll('*'):[])).forEach(function(element){if(typeof element._aiCleanupBubble==='function')try{element._aiCleanupBubble();}catch(_){}});}
    function restoreSubtree(node){if(!node)return;[node].concat(Array.from(node.querySelectorAll?node.querySelectorAll('*'):[])).forEach(function(element){if(typeof element._aiRestoreBubble==='function')try{element._aiRestoreBubble();}catch(_){}});}
    function releaseItem(item){if(!item)return;if(observer)observer.unobserve(item.node);if(item.stubLife)item.stubLife.abort();cleanupSubtree(item.body);cleanupSubtree(item.fragment);reports.forEach(function(report,node){if(item.node.contains(node)||item.fragment&&item.fragment.contains(node))report.dispose();});}
    function preserveAnchor(action){
      if(!visible()){action();return;}
      var top=scrollBox.getBoundingClientRect().top,anchor=null;
      items.forEach(function(item){if(!item.node.isConnected)return;var rect=item.node.getBoundingClientRect();if(rect.bottom>top+2&&rect.top<top+scrollBox.clientHeight&&(!anchor||rect.top<anchor.offset+top))anchor={item:item,offset:rect.top-top};});
      action();
      if(anchor&&anchor.item.node.isConnected){var next=anchor.item.node.getBoundingClientRect().top-scrollBox.getBoundingClientRect().top;var delta=next-anchor.offset;if(Math.abs(delta)>.5)scrollBox.scrollTop+=delta;}
    }
    function protectedItem(item){
      if(item.pin||item.node.contains(doc.activeElement))return true;
      var selection=global.getSelection&&global.getSelection();if(!selection||selection.isCollapsed)return false;
      try{for(var i=0;i<selection.rangeCount;i++){if(selection.getRangeAt(i).intersectsNode(item.node))return true;}}catch(_){}
      return false;
    }
    function nearby(item){
      if(!visible()||!item.node.isConnected)return true;
      var a=item.node.getBoundingClientRect(),b=scrollBox.getBoundingClientRect(),margin=Math.max(600,scrollBox.clientHeight);
      return a.bottom>b.top-margin && a.top<b.bottom+margin;
    }
    function placeholder(item,height){
      if(item.stubLife)item.stubLife.abort();item.stubLife=new AbortController();
      var stub=doc.createElement('div');stub.className='ai-reading-placeholder';stub.style.minHeight=Math.max(40,height)+'px';
      var button=doc.createElement('button');button.type='button';button.className='ai-reading-load';button.textContent='加载这条历史消息';button.setAttribute('aria-label','加载这条历史消息');button.addEventListener('click',function(){if(!current())return;item.pin=true;mount(item);var focus=item.body.querySelector('button,a[href],input,textarea,[tabindex]')||item.node;focus.tabIndex=focus.tabIndex<0?0:focus.tabIndex;focus.focus({preventScroll:true});},{signal:item.stubLife.signal});stub.append(button);return stub;
    }
    function mount(item){
      if(!current()||item.mounted)return;
      var token=epoch;
      preserveAnchor(function(){
        if(item.factory){var rendered=item.factory(item.message,item.index);if(!current()||token!==epoch)return;if(!rendered||!rendered.nodeType)throw Error('历史消息渲染器需要返回 DOM 节点');item.body.replaceChildren(rendered);}
        else if(item.fragment){item.body.replaceChildren(item.fragment);item.fragment=null;restoreSubtree(item.body);}
        item.mounted=true;item.node.classList.remove('ai-reading-unmounted');item.body.style.minHeight='';item.stub=null;if(item.stubLife){item.stubLife.abort();item.stubLife=null;}
        item.height=Math.max(40,item.body.getBoundingClientRect().height||item.height);
      });
    }
    function unmount(item){
      if(!current()||!item.mounted||protectedItem(item)||nearby(item))return;
      preserveAnchor(function(){
        item.height=Math.max(40,item.body.getBoundingClientRect().height||item.height);
        cleanupSubtree(item.body);
        if(item.factory)reports.forEach(function(report,node){if(item.node.contains(node)){report.dispose();reports.delete(node);}});
        if(!item.factory){item.fragment=doc.createDocumentFragment();while(item.body.firstChild)item.fragment.append(item.body.firstChild);}
        item.stub=placeholder(item,item.height);item.body.replaceChildren(item.stub);item.body.style.minHeight=item.height+'px';item.mounted=false;item.node.classList.add('ai-reading-unmounted');
      });
    }
    function update(){
      frame=0;if(!visible())return;
      var stale=[];
      items.forEach(function(item){
        if(!item.node.isConnected){stale.push(item);return;}
        if(nearby(item)||protectedItem(item)){try{mount(item);}catch(e){if(options.notify)options.notify(e.message);}}else unmount(item);
      });
      stale.forEach(function(item){
        if(observer){try{observer.unobserve(item.node);}catch(_){}}
        releaseItem(item);
        items.delete(item.id);
      });
    }
    function schedule(){if(!current()||frame)return;var token=epoch;frame=global.requestAnimationFrame(function(){if(token===epoch)update();else frame=0;});}
    if(typeof global.IntersectionObserver==='function')observer=new global.IntersectionObserver(function(entries){if(!current())return;entries.forEach(function(entry){var item=items.get(entry.target.dataset.readingId);if(item&&entry.isIntersecting){try{mount(item);}catch(e){if(options.notify)options.notify(e.message);}}});schedule();},{root:scrollBox,rootMargin:'800px 0px',threshold:0});
    function track(node,message,config){
      if(!current()||!node)return node;config=config||{};
      var id=idOf(node,message,config.index),existing=items.get(id);if(existing&&existing.node===node){existing.message=message;if(config.pin!==undefined)existing.pin=!!config.pin;return node;}
      releaseItem(existing);
      var body=config.heavyNode||node.querySelector('.ai-msg-bubble,.dt-msg-content,.ai-reading-content')||node;
      var item={id:id,node:node,body:body,message:message,index:config.index||0,pin:!!config.pin,height:estimateHeight(message,scrollBox.clientWidth),mounted:true,fragment:null,factory:null};
      node.dataset.readingId=id;items.set(id,item);if(observer)observer.observe(node);schedule();return node;
    }
    function makeMessage(message,index,total){
      if(!current())return doc.createDocumentFragment();
      if(typeof options.renderMessage!=='function')throw Error('按需历史需要 renderMessage 回调');
      var node=doc.createElement('div'),body=doc.createElement('div'),id=messageId(message,index),height=estimateHeight(message,scrollBox.clientWidth);
      node.className='ai-reading-shell';node.dataset.readingId=id;body.className='ai-reading-content';node.append(body);
      releaseItem(items.get(id));var item={id:id,node:node,body:body,message:message,index:index,pin:false,height:height,mounted:false,fragment:null,factory:options.renderMessage};items.set(id,item);
      item.stub=placeholder(item,height);body.append(item.stub);body.style.minHeight=height+'px';node.classList.add('ai-reading-unmounted');
      // The newest few messages are immediately usable; older Markdown is not
      // parsed until it approaches the real scrolling viewport.
      if(index>=Math.max(0,(total||0)-4))mount(item);
      if(observer)observer.observe(node);schedule();return node;
    }
    function ensureAll(){if(!current())return;items.forEach(function(item){mount(item);});}
    function headingKey(heading,index){return {index:index,text:String(heading.textContent||'').trim().slice(0,200)};}
    function decorateReport(value){
      if(!current()||!value||!value.node||!value.contentEl)return null;
      var node=value.node,content=value.contentEl,old=reports.get(node);if(old)old.dispose();var reportLife=new AbortController(),reportId=++reportSerial;
      var headings=Array.from(content.querySelectorAll('h1,h2,h3,h4')).filter(function(h){return h.textContent.trim();}),ancestor=node.closest('[data-reading-id]'),report={node:node,content:content,text:String(value.text||''),headings:headings,toc:null,cleanup:[],itemId:ancestor&&ancestor.dataset.readingId};
      reports.set(node,report);
      if(headings.length>=2){
        var details=doc.createElement('details'),summary=doc.createElement('summary'),nav=doc.createElement('nav');details.className='ai-reading-toc';summary.textContent='报告目录 · '+headings.length+' 节';nav.setAttribute('aria-label','报告目录');details.append(summary,nav);report.toc=details;
        headings.slice(0,500).forEach(function(heading,index){var oldId=heading.id,oldTabIndex=heading.getAttribute('tabindex'),assignedId='ai-report-'+instance+'-'+reportId+'-'+index;if(!heading.id)heading.id=assignedId;var button=doc.createElement('button');button.type='button';button.className='ai-reading-toc-link';button.textContent=heading.textContent.trim();button.dataset.level=heading.tagName.slice(1);button.addEventListener('click',function(){if(!current()||reportLife.signal.aborted)return;var item=report.itemId&&items.get(report.itemId);if(item)mount(item);var top=heading.getBoundingClientRect().top-scrollBox.getBoundingClientRect().top+scrollBox.scrollTop-12;var reduce=global.matchMedia&&global.matchMedia('(prefers-reduced-motion: reduce)').matches || doc.documentElement.classList.contains('xtj-reduce-motion') || doc.documentElement.getAttribute('data-xtj-motion')==='off';scrollBox.scrollTo({top:Math.max(0,top),behavior:reduce?'auto':'smooth'});heading.tabIndex=-1;heading.focus({preventScroll:true});queueRemember();},{signal:reportLife.signal});nav.append(button);report.cleanup.push(function(){if(!oldId&&heading.id===assignedId)heading.removeAttribute('id');if(oldTabIndex===null)heading.removeAttribute('tabindex');else heading.setAttribute('tabindex',oldTabIndex);});});
        if(headings.length>500){var note=doc.createElement('p');note.textContent='目录列出前 500 节，完整报告仍保留全部章节。';nav.append(note);}
        content.parentNode.insertBefore(details,content); // Never wrap/rewrite the safe Markdown.
      }
      // Native visibility containment skips offscreen layout while the complete
      // safe DOM and authoritative report text remain available for export.
      Array.from(content.children).forEach(function(block){if(!['PRE','TABLE','BLOCKQUOTE'].includes(block.tagName))return;var before=block.style.contentVisibility,intrinsic=block.style.containIntrinsicSize;block.style.contentVisibility='auto';block.style.containIntrinsicSize='auto 160px';report.cleanup.push(function(){block.style.contentVisibility=before;block.style.containIntrinsicSize=intrinsic;});});
      report.dispose=function(){if(reportLife.signal.aborted)return;reportLife.abort();if(details)details.remove();report.cleanup.forEach(function(fn){fn();});report.cleanup=[];if(reports.get(node)===report)reports.delete(node);};
      return {toc:report.toc,headings:headings,getText:function(){return current()?report.text:'';},dispose:report.dispose};
    }
    function remember(){
      if(!visible())return false;var top=scrollBox.getBoundingClientRect().top,anchor=null;
      items.forEach(function(item){if(item.id.startsWith('temporary:')||!item.node.isConnected)return;var rect=item.node.getBoundingClientRect();if(rect.bottom>top+2&&rect.top<top+scrollBox.clientHeight&&(!anchor||rect.top<anchor.offset+top))anchor={id:item.id,offset:rect.top-top};});
      if(!anchor)return false;
      reports.forEach(function(report){if(!items.has(anchor.id)||!items.get(anchor.id).node.contains(report.node))return;var closest=null;report.headings.forEach(function(heading,index){if(!heading.isConnected)return;var pos=heading.getBoundingClientRect().top-top;if(pos<=12)closest={heading:headingKey(heading,index),offset:pos};});if(closest){anchor.heading=closest.heading;anchor.headingOffset=closest.offset;}});
      var value={v:1,owner:String(options.owner),key:String(options.key),anchor:anchor,time:Date.now()};
      try{global.localStorage.setItem(storageKey,JSON.stringify(value));return true;}catch(_){return false;}
    }
    function queueRemember(){if(!current())return;clearTimeout(rememberTimer);rememberTimer=setTimeout(function(){rememberTimer=0;if(current())remember();},350);}
    function restore(){
      if(!visible())return Promise.resolve(false);var saved;
      try{saved=JSON.parse(global.localStorage.getItem(storageKey)||'null');}catch(_){return Promise.resolve(false);}
      if(!saved||saved.v!==1||saved.owner!==String(options.owner)||saved.key!==String(options.key)||!saved.anchor||Date.now()-saved.time>30*24*3600000)return Promise.resolve(false);
      var item=items.get(saved.anchor.id);if(!item||!item.node.isConnected)return Promise.resolve(false);
      mount(item);var token=epoch;
      if(restoreFrame){global.cancelAnimationFrame(restoreFrame);restoreFrame=0;if(restoreResolve)restoreResolve(false);}
      return new Promise(function(resolve){restoreResolve=resolve;restoreFrame=global.requestAnimationFrame(function(){restoreFrame=0;restoreResolve=null;if(!current()||token!==epoch||!item.node.isConnected){resolve(false);return;}var target=item.node,offset=Number(saved.anchor.offset)||0;if(saved.anchor.heading){var found=null;reports.forEach(function(report){if(!item.node.contains(report.node))return;var heading=report.headings[saved.anchor.heading.index];if(heading&&heading.textContent.trim().slice(0,200)===saved.anchor.heading.text)found=heading;});if(!found){resolve(false);return;}target=found;offset=Number(saved.anchor.headingOffset)||0;}var top=target.getBoundingClientRect().top-scrollBox.getBoundingClientRect().top+scrollBox.scrollTop-offset;scrollBox.scrollTop=Math.max(0,top);schedule();resolve(true);});});
    }
    function viewport(){
      if(!current())return;var vv=global.visualViewport,height=vv&&Number(vv.height)||global.innerHeight,top=vv&&Number(vv.offsetTop)||0,width=vv&&Number(vv.width)||global.innerWidth;
      viewportTargets.forEach(function(entry){var style=global.getComputedStyle(entry.target),fixedTop=parseFloat(style.top),inset=style.position==='fixed'&&Number.isFinite(fixedTop)?Math.max(0,fixedTop-top):entry.inset;entry.target.style.setProperty('--ai-reading-visible-height',Math.max(80,height-inset)+'px');entry.target.style.setProperty('--ai-reading-viewport-width',Math.max(240,width)+'px');});
      // Scroll only when the user's active composer is actually obscured. This
      // never focuses it, moves a hidden history panel, or changes the Dock.
      var input=options.input;if(input&&doc.activeElement===input&&input.isConnected&&input.getClientRects().length){var r=input.getBoundingClientRect(),bottom=top+height;if(r.bottom>bottom-8||r.top<top+8){var own=options.inputScrollBox;if(own&&own.contains(input))own.scrollTop+=r.bottom>bottom-8?r.bottom-bottom+8:r.top-top-8;}}
      schedule();
    }
    var viewportHost=options.viewportHost;
    if(viewportHost){viewportTargets.push({target:viewportHost,height:viewportHost.style.getPropertyValue('--ai-reading-visible-height'),width:viewportHost.style.getPropertyValue('--ai-reading-viewport-width'),inset:Math.max(0,viewportHost.getBoundingClientRect().top-(global.visualViewport&&global.visualViewport.offsetTop||0))});viewportHost.classList.add('ai-reading-viewport');}
    if(global.visualViewport){global.visualViewport.addEventListener('resize',viewport,{signal:life.signal});global.visualViewport.addEventListener('scroll',viewport,{signal:life.signal});}global.addEventListener('resize',viewport,{signal:life.signal});viewport();
    scrollBox.addEventListener('scroll',function(){schedule();queueRemember();},{passive:true,signal:life.signal});
    container.addEventListener('focusin',function(event){var node=event.target.closest('[data-reading-id]'),item=node&&items.get(node.dataset.readingId);if(item)mount(item);},{signal:life.signal});
    doc.addEventListener('selectionchange',schedule,{signal:life.signal});
    container.addEventListener('keydown',function(event){var target=event.target;if(target&&(target.isContentEditable||target.closest('input,textarea,select')))return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a')ensureAll();},{capture:true,signal:life.signal});
    global.addEventListener('pagehide',remember,{signal:life.signal});
    global.addEventListener('xtj:auth-changed',function(){dispose({forget:true});},{signal:life.signal});
    function dispose(config){if(disposed)return;if(!config||!config.forget)remember();else{try{global.localStorage.removeItem(storageKey);}catch(_){}}disposed=true;epoch++;life.abort();clearTimeout(rememberTimer);if(frame)global.cancelAnimationFrame(frame);if(restoreFrame)global.cancelAnimationFrame(restoreFrame);if(restoreResolve){restoreResolve(false);restoreResolve=null;}if(observer)observer.disconnect();if(originalScrollTabIndex===null&&scrollBox.getAttribute('tabindex')==='0')scrollBox.removeAttribute('tabindex');items.forEach(function(item){releaseItem(item);if(item.fragment&&item.body.isConnected){item.body.replaceChildren(item.fragment);item.body.style.minHeight='';item.node.classList.remove('ai-reading-unmounted');}});reports.forEach(function(report){report.dispose();});reports.clear();items.clear();viewportTargets.forEach(function(entry){if(entry.height)entry.target.style.setProperty('--ai-reading-visible-height',entry.height);else entry.target.style.removeProperty('--ai-reading-visible-height');if(entry.width)entry.target.style.setProperty('--ai-reading-viewport-width',entry.width);else entry.target.style.removeProperty('--ai-reading-viewport-width');entry.target.classList.remove('ai-reading-viewport');});}
    return {makeMessage:makeMessage,track:track,decorateReport:decorateReport,remember:remember,restore:restore,ensureAll:ensureAll,refresh:schedule,dispose:dispose,getFullText:function(node){var report=reports.get(node);if(report)return current()?report.text:'';var item=node&&items.get(node.dataset.readingId);return current()&&item?String(item.message.content||item.message.answer||''):'';}};
  }
  var api={create:create,messageId:messageId,estimateHeight:estimateHeight,positionKey:positionKey};
  if(typeof module==='object'&&module.exports)module.exports=api;
  global.XtjAiCore=global.XtjAiCore||{};global.XtjAiCore.ReadingTools=api;
}(typeof window!=='undefined'?window:globalThis));
