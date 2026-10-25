'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path');
const directory=path.resolve(process.env.XTJ_FEATURE_SCREENSHOTS||'output/feature-screenshots');
const hook=path.resolve(__dirname,'../tests/helpers/screenshot-evidence.cjs');
const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['test'],{stdio:'inherit',env:{...process.env,XTJ_FEATURE_SCREENSHOTS:directory,NODE_OPTIONS:[process.env.NODE_OPTIONS,'--require='+hook].filter(Boolean).join(' ')}});
if(result.error)throw result.error;process.exitCode=result.status??1;
