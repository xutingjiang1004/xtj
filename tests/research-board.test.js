'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createResearchBoard}=require('../render-api/research-board');
test('research board only counts actual successful directions and separates returned, missing and estimated usage',()=>{
 const frames=[],board=createResearchBoard({emit:e=>frames.push(e),checkpoint:true,previousSearch:7});
 board.direction('a','已完成方向','success',true);board.direction('b','新方向','running');board.search();board.usage({prompt_tokens:3,completion_tokens:5});board.usage(null);board.estimate(4);board.saved('checkpoint','saved');
 const view=frames.at(-1);assert.equal(view.completed,1);assert.equal(view.total,2);assert.equal(view.search_calls,1);assert.equal(view.previous_search_calls,7);assert.equal(view.usage.actual_tokens,8);assert.equal(view.usage.estimated_tokens,4);assert.equal(view.usage.missing_requests,1);assert.equal(view.save.checkpoint,'saved');
 board.direction('b','新方向','failed');assert.equal(board.snapshot().completed,1);
});
test('unknown usage remains unknown instead of a fabricated zero and cached work is not counted as a new search',()=>{
 const board=createResearchBoard({previousSearch:5});assert.equal(board.snapshot().usage.actual_tokens,null);assert.equal(board.snapshot().search_calls,0);assert.equal(board.snapshot().save.checkpoint,'unavailable');
});
