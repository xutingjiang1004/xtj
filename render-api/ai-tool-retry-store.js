'use strict';
function createToolRetryStore(db) {
  async function call(owner,turn,callId,feedback,cards,signal) {
    let query=db.rpc('save_ai_tool_retry_result',{p_user_name:owner.userName,p_account_id:owner.accountId,
      p_conversation_id:turn.conversationId,p_request_id:turn.requestId,p_call_id:callId,
      p_feedback:feedback||null,p_cards:cards||null});
    if(signal && query && typeof query.abortSignal==='function')query=query.abortSignal(signal);
    const result=await query;
    if(!result||result.error||!result.data)throw Object.assign(Error('工具结果暂时无法同步，请重试；已完成的工具不会重复执行',{cause:result&&result.error}),{status:503});
    if(!result.data.ok) {
      const limit=result.data.error==='retry_artifacts_limit';
      throw Object.assign(Error(limit?'会话成果超过保存上限，请另开对话':'原会话或工具步骤已不可更新，请刷新历史后查看'),{status:limit?413:409});
    }
    return result.data;
  }
  return {
    inspect(owner,turn,callId,signal){return call(owner,turn,callId,null,null,signal);},
    save(owner,turn,callId,feedback,cards,signal){return call(owner,turn,callId,feedback,cards,signal);}
  };
}
module.exports={createToolRetryStore};
