const crypto=require('node:crypto');
const {TaskProgress}=require('./task.cjs');

async function runVisual({store,thread,project,text,computer,vision,emit,signal}) {
  const requirements={computer:/\b(click|type|write|fill|save|press|open|navigate|search|calculate|add|select|scroll|complete)\b|क्लिक|टाइप|खोल|लिख|भरो/i.test(text)?'act':'observe'};
  const progress=new TaskProgress(requirements), history=[];
  const mustType=/\b(type|replace|enter|fill|write)\b|टाइप|लिख|भरो/i.test(text);
  const user={id:crypto.randomUUID(),role:'user',content:text,createdAt:Date.now(),contextFiles:[]};
  thread.messages.push(user);thread.modelMessages.push({role:'user',content:text});
  if(thread.title==='New chat')thread.title=text.replace(/\s+/g,' ').slice(0,52);
  thread.updatedAt=Date.now();store.save();emit({type:'thread',thread});
  const assistant={id:crypto.randomUUID(),role:'assistant',content:'Starting the local vision model…',streaming:true,createdAt:Date.now()};
  thread.messages.push(assistant);emit({type:'message',message:assistant});
  const tool=async(name,args,operation)=>{
    const entry={id:crypto.randomUUID(),role:'tool',name,arguments:JSON.stringify(args),status:'running',createdAt:Date.now()};
    thread.messages.push(entry);emit({type:'message',message:entry});
    try {
      const value=await operation();const {image,...metadata}=value;
      entry.result=metadata;entry.status=value.error?'error':'done';progress.record(name,args,metadata);
      return value;
    } catch(error) {entry.result={error:error.message};entry.status='error';throw error;}
    finally{store.save();emit({type:'message-update',message:entry});}
  };
  try {
    await vision.ensure(signal);
    let failures=0, lastInput='', repeatedInputObserved=false, completionRetries=0;
    for(let step=0;step<12;step++) {
      signal.throwIfAborted();
      assistant.content='Looking at the selected app…';emit({type:'message-update',message:assistant});
      const observation=await tool('computer_observe',{},()=>computer.observe(thread.id,signal));
      let checked=null;
      if(vision.verify&&!progress.missing().length&&(!mustType||progress.computerActions.some(action=>action.action==='type'))) {
        checked=await vision.verify(text,observation,history,signal);assistant.tokensPerSecond=checked.timing;
        history.push({action:'screen-check',outcome:checked.evidence});
        if(checked.satisfied){assistant.content=checked.evidence;assistant.work=progress.snapshot(project||{id:null,root:''},'completed');break;}
      }
      const {decision,timing}=await vision.decide(text,observation,history,signal);
      assistant.tokensPerSecond=timing;
      if(decision.action==='done') {
        if(checked&&!checked.satisfied){
          if(completionRetries++<1){history.push({action:'completion-check',outcome:'The separate screen check says the task is NOT finished: '+checked.evidence});continue;}
          throw new Error('The requested outcome was not verified on screen: '+checked.evidence);
        }
        const missing=progress.missing();
        if(mustType&&!progress.computerActions.some(action=>action.action==='type'))missing.push('complete an exact, verified text entry in the requested field');
        if(missing.length&&completionRetries++<1){history.push({action:'completion-check',outcome:'The user task is incomplete: '+missing.join('; ')});continue;}
        if(missing.length)throw new Error('The vision model reported completion without the required app action. '+missing.join('; '));
        assistant.content=decision.summary||'The requested app outcome was checked in the latest screenshot.';
        assistant.work=progress.snapshot(project||{id:null,root:''},'completed');break;
      }
      if(decision.action==='blocked')throw new Error(decision.summary||decision.reason||'This screen needs manual handling.');
      const signature=JSON.stringify([decision.action,decision.target,decision.text,decision.key,decision.direction,decision.x,decision.y]);
      if(signature===lastInput&&!repeatedInputObserved){
        repeatedInputObserved=true;history.push({action:'reobserve',outcome:'The previous input was already performed. Wait for the app to repaint and check the updated screenshot before repeating it.'});
        await new Promise(resolve=>setTimeout(resolve,500));continue;
      }
      assistant.content='Review the proposed visual app action.';emit({type:'message-update',message:assistant});
      const args={...decision,snapshot:observation.snapshot};
      try {
        const result=await tool('computer_act',args,()=>computer.act(thread.id,args,signal));
        if(result.approved===false){assistant.content='The app action was not approved, so input stopped.';assistant.work=progress.snapshot(project||{id:null,root:''},'declined');break;}
        history.push({action:decision.action,target:decision.target,text:decision.action==='type'?decision.text:undefined,key:decision.key,outcome:'input performed; verify on next screenshot'});failures=0;
        lastInput=signature;repeatedInputObserved=false;
        await new Promise(resolve=>setTimeout(resolve,500));
      } catch(error) {
        signal.throwIfAborted();history.push({action:decision.action,target:decision.target,outcome:error.message});
        if(++failures>=2)throw error;
      }
      if(step===11)throw new Error('Reached the 12-step visual task limit. Work is incomplete; inspect the app before continuing.');
    }
    if(!assistant.work)throw new Error('Reached the 12-step visual task limit. Work is incomplete; inspect the app before continuing.');
  } catch(error) {
    assistant.content=signal.aborted?'Visual task stopped.':error.message;
    assistant.work=progress.snapshot(project||{id:null,root:''},'incomplete');
  } finally {
    assistant.streaming=false;thread.modelMessages.push({role:'assistant',content:assistant.content});store.save();emit({type:'message-update',message:assistant});
  }
}
module.exports={runVisual};
