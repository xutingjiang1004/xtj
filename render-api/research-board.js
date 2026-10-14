'use strict';
function createResearchBoard(options={}){
  const previous=options.previousUsage||{};
  const state={stage:'planning',directions:[],completed:0,total:0,search_calls:0,previous_search_calls:Number(options.previousSearch)||0,
    unique_sources:0,raw_sources:0,merged_sources:0,documents:options.documents||[],
    save:{checkpoint:options.checkpoint?'pending':'unavailable',report:'pending'},
    usage:{actual_tokens:Number(previous.actual_tokens)||0,estimated_tokens:Number(previous.estimated_tokens)||0,returned_requests:Number(previous.returned_requests)||0,missing_requests:Number(previous.missing_requests)||0}};
  function snapshot(){const copy=JSON.parse(JSON.stringify(state));if(!copy.usage.returned_requests)copy.usage.actual_tokens=null;return copy;}
  function publish(){state.completed=state.directions.filter(d=>d.status==='success').length;state.total=state.directions.length;if(options.emit)options.emit({type:'research_board',...snapshot()});}
  return {
    set(patch){Object.assign(state,patch);publish();},
    direction(id,role,status,restored=false){let item=state.directions.find(d=>d.id===id);if(!item){item={id,role,status,restored};state.directions.push(item);}else Object.assign(item,{role,status,restored});publish();},
    search(){state.search_calls++;publish();},
    usage(value){
      if(!value||typeof value!=='object'||value._reported===false){state.usage.missing_requests++;publish();return;}
      const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:NaN;
      const prompt=number(value.prompt_tokens??value.input_tokens),completion=number(value.completion_tokens??value.output_tokens),total=number(value.total_tokens);
      if(!Number.isFinite(total)&&!Number.isFinite(prompt)&&!Number.isFinite(completion)){state.usage.missing_requests++;publish();return;}
      state.usage.missing_requests+=Math.max(0,Number(value._missing_usage)||0);state.usage.returned_requests++;state.usage.actual_tokens+=Math.max(0,Number.isFinite(total)?total:(prompt||0)+(completion||0));publish();
    },
    estimate(tokens){state.usage.estimated_tokens+=Math.max(0,Number(tokens)||0);publish();},
    saved(kind,status){state.save[kind]=status;publish();},
    snapshot
  };
}
module.exports={createResearchBoard};
