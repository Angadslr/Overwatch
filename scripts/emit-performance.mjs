import {spawn} from 'node:child_process';
const [root,command,nonce]=process.argv.slice(2),children=new Set(),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let index=0,running=false;
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const stop=()=>{for(const child of children)child.kill('SIGKILL');process.exit(0);};process.on('SIGTERM',stop);process.on('disconnect',stop);
async function emit(reportView,response,closed){
 const sequence=index++,conversation=`t22-${nonce}-${sequence%50}`,call=`t22-call-${sequence}`,start=process.hrtime.bigint();if(reportView)process.send?.({type:'started',conversation,call,startedNs:start.toString()});
 await new Promise((done,reject)=>{const child=spawn('/bin/sh',['-c',command],{stdio:['pipe','pipe','pipe']});children.add(child);let stdout='',stderr='',first=true;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('helper-timeout'));},5000);
  child.stdout.on('data',bytes=>{stdout+=bytes;if(first){first=false;response.push(Number(process.hrtime.bigint()-start)/1e6);}});child.stderr.on('data',bytes=>stderr+=bytes);child.stdin.on('error',()=>{});child.on('error',reject);child.on('close',code=>{clearTimeout(timer);children.delete(child);if(code!==0||stdout!=='{"permission":"allow"}\n'||stderr)return reject(new Error('helper-response'));closed.push(Number(process.hrtime.bigint()-start)/1e6);done();});
  child.stdin.end(JSON.stringify({hook_event_name:'beforeReadFile',cursor_version:'3.26.16',workspace_roots:[root],conversation_id:conversation,generation_id:'t22-turn',tool_use_id:call,tool_name:'Read',file_path:root+'/read.txt'}));
 });
}
process.on('message',async message=>{
 if(running||!['first','normal','burst'].includes(message?.stage))return;running=true;const stage=message.stage,count=stage==='first'?1:stage==='normal'?40:2000,rate=stage==='burst'?200:20,response=[],closed=[],jobs=[],errors=[],start=process.hrtime.bigint();
 try{for(let i=0;i<count;i++){const wait=i*1000/rate-Number(process.hrtime.bigint()-start)/1e6;if(wait>0)await delay(wait);jobs.push(emit(stage!=='burst',response,closed).catch(()=>errors.push('helper-stage-failed')));}await Promise.all(jobs);
  process.send?.({type:'complete',stage,attempts:count,errors:errors.length,responseP50Ms:percentile(response,.5),responseP95Ms:percentile(response,.95),closedP50Ms:percentile(closed,.5),closedP95Ms:percentile(closed,.95),closedMaxMs:Math.max(...closed),elapsedMs:Number(process.hrtime.bigint()-start)/1e6});
 }catch{process.send?.({type:'failed',stage});}finally{running=false;}
});
