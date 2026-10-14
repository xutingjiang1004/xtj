'use strict';

function createWorkbenchAssets(db) {
  async function call(owner,op,value={}) {
    if(!owner || !owner.userName || !owner.accountId) throw Object.assign(Error('identity required'),{code:'asset_identity_changed'});
    const result=await db.rpc('manage_ai_workbench_asset',{
      p_user_name:owner.userName,p_account_id:String(owner.accountId),p_op:op,
      p_id:value.id||null,p_kind:value.kind||null,p_title:value.title||null,
      p_data:value.data||null,p_expected_updated_at:value.updated_at||null
    });
    if(!result || result.error)throw Object.assign(Error('assets unavailable'),{code:'asset_storage_unavailable'});
    if(!result.data || !result.data.ok)throw Object.assign(Error('asset request failed'),{code:result.data&&result.data.error||'asset_storage_unavailable'});
    return result.data;
  }
  return {
    async list(owner){return (await call(owner,'list')).records||[];},
    async get(owner,id){return (await call(owner,'get',{id})).record||null;},
    async save(owner,value){return (await call(owner,'save',value)).record;},
    async remove(owner,id){return (await call(owner,'remove',{id})).removed===true;}
  };
}
module.exports={createWorkbenchAssets};
