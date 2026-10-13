'use strict';
const {TIMESTAMP}=require('./post-interactions');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORTS=new Set(['date_desc','date_asc','name','size','views']);
async function readPhotoWallPage(db,query={}) {
  const sort=query.sort||'date_desc';
  if(!SORTS.has(sort))throw Object.assign(new Error('照片排序参数无效'),{status:400});
  let cursor=null;
  if(query.cursor){
    try{cursor=JSON.parse(query.cursor);}catch(_){throw Object.assign(new Error('照片分页参数无效'),{status:400});}
    if(!cursor||cursor.sort!==sort||!UUID.test(String(cursor.id))||!TIMESTAMP.test(String(cursor.at))||!Number.isFinite(Date.parse(cursor.at))||
      (sort==='name'&&(typeof cursor.value!=='string'||cursor.value.length>100))||
      (['size','views'].includes(sort)&&!/^\d{1,19}$/.test(String(cursor.value))))throw Object.assign(new Error('照片分页参数无效'),{status:400});
  }
  const limit=Math.min(100,Math.max(1,parseInt(query.limit,10)||20)),page=Math.max(0,parseInt(query.page,10)||0);
  if(page>100000)throw Object.assign(new Error('照片分页参数无效'),{status:400});
  const result=await db.rpc('xtj_photo_wall_page',{p_sort:sort,p_limit:limit,p_cursor:cursor,p_offset:cursor?0:page*limit});
  if(result.error||!result.data||!Array.isArray(result.data.data))throw Object.assign(new Error('照片墙暂不可用，请重试'),{status:503});
  return result.data;
}
module.exports={readPhotoWallPage,SORTS};
