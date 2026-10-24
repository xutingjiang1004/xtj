'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),http=require('node:http');
test('upgraded MCP SDK/Zod: three real stdio servers negotiate, list schemas and execute validated calls',{timeout:30000},async()=>{
 const {Client}=await import('../xtj-admin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
 const {StdioClientTransport}=await import('../xtj-admin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'xtj-mcp-'));
 const api=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,token:'fixture-token',users:[]}));});
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 const recipients=[],smtp=require('node:net').createServer(socket=>{
  socket.setEncoding('utf8');socket.write('220 local fixture ESMTP\r\n');let buffer='',data=false;
  socket.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\r\n')){
   const at=buffer.indexOf('\r\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+2);
   if(data){if(line==='.') {data=false;socket.write('250 accepted locally\r\n');}continue;}
   if(/^EHLO|^HELO/i.test(line))socket.write('250 local fixture\r\n');
   else if(/^MAIL FROM:/i.test(line))socket.write('250 sender accepted\r\n');
   else if(/^RCPT TO:/i.test(line)){recipients.push(line);socket.write('250 recipient accepted\r\n');}
   else if(/^DATA$/i.test(line)){data=true;socket.write('354 send data\r\n');}
   else if(/^QUIT$/i.test(line))socket.end('221 bye\r\n');
   else socket.write('250 OK\r\n');
  }});
 });
 await new Promise(resolve=>smtp.listen(0,'127.0.0.1',resolve));
 try{
  const image=path.join(directory,'fixture.png');await require('sharp')({create:{width:8,height:8,channels:3,background:'#44aa88'}}).png().toFile(image);
  for(const name of ['xtj-admin','xtj-email','xtj-image']){
   const env={PATH:process.env.PATH,NODE_ENV:'test',XTJ_API_BASE:'http://127.0.0.1:'+api.address().port,XTJ_MCP_ALLOW_LOCALHOST:'true',IMAGE_SOURCE_DIR:directory,EMAIL_PROVIDER:'smtp',FROM_EMAIL:'fixture@example.invalid',ADMIN_NOTIFY_EMAIL:'allowed@example.invalid',ALLOWED_RECIPIENTS:'allowed@example.invalid',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtp.address().port)};
   const client=new Client({name:'xtj-test',version:'1.0.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp-servers',name,'server.js')],env,stderr:'pipe'});
   let errors='';transport.stderr?.on('data',data=>{errors+=data.toString()});
   try{
    await client.connect(transport);const listed=await client.listTools();assert.ok(listed.tools.length>=3);
    for(const tool of listed.tools)assert.equal(tool.inputSchema.type,'object');
    if(name==='xtj-admin'){
     const result=await client.callTool({name:'admin_login',arguments:{username:'fixture',password:'fixture'}});assert.notEqual(result.isError,true);
    }else if(name==='xtj-email'){
     const invalid=await client.callTool({name:'send_email',arguments:{to:'invalid address',subject:'fixture'}});assert.equal(invalid.isError,true);
     const denied=await client.callTool({name:'send_email',arguments:{to:'other@example.invalid',subject:'fixture',text:'fixture'}});assert.equal(denied.isError,true);assert.match(JSON.stringify(denied),/白名单/);
     const sent=await client.callTool({name:'send_email',arguments:{to:'allowed@example.invalid',subject:'local fixture',text:'local verification only'}});assert.notEqual(sent.isError,true);assert.deepEqual(recipients,['RCPT TO:<allowed@example.invalid>']);
    }else{
     const invalid=await client.callTool({name:'image_resize',arguments:{filepath:image,width:10001}});assert.equal(invalid.isError,true);
     const result=await client.callTool({name:'image_convert',arguments:{filepath:image,format:'webp'}});assert.notEqual(result.isError,true);assert.ok((await fs.readdir(directory)).some(file=>file.endsWith('.webp')));
    }
   }catch(error){error.message=name+': '+error.message+' '+errors;throw error;}finally{await client.close();}
  }
 }finally{await new Promise(resolve=>api.close(resolve));await new Promise(resolve=>smtp.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
});
