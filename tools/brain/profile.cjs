'use strict';
// Deployment refinement of the original OmniCoder checkpoint, not a new set of weights.
const PROFILES=new Set(['current-wsp','original-fast','deep-math-256','deep-math-512','concise-original','concise-deep-256']);
function validateConfig(value={}) {
  const config={schema:1,profile:value.profile||'current-wsp',context:value.context||4096,cachePrompt:false};
  if(value.schema!==undefined&&value.schema!==1)throw new Error('Unsupported Buji brain config schema.');
  if(!PROFILES.has(config.profile)||![4096,8192].includes(config.context))throw new Error('Unsupported Buji brain profile/context.');
  return config;
}
function applyProfile(payload,decision,configuration,originalOnly=false) {
  const config=validateConfig(configuration);
  let scales=decision.name==='math-wsp'?[.5,.5]:[0,0];
  let profile=decision.name==='math-wsp'?'current-wsp':'original-protected';
  const body={...payload,cache_prompt:false};
  const explicitOff=payload.reasoning_effort==='none'||payload.chat_template_kwargs?.enable_thinking===false;
  const eligible=!originalOnly&&decision.name==='math-wsp'&&!(payload.tools?.length)&&!explicitOff&&!payload.response_format;
  if(originalOnly) {scales=[0,0];profile='original-control';}
  else if(eligible&&config.profile!=='current-wsp') {
    scales=[0,0];profile=config.profile;
    body.reasoning_format='deepseek';
    if(profile.startsWith('concise-')) {
      const suffix=' Prefer a short exact derivation: first look for symmetry, an invariant, a bound, or a simplifying substitution. Check domain restrictions and substitute the result back when possible. Keep working under 180 words, avoid repeated exploratory algebra, and retain the requested final-answer format. Do not guess a result merely to finish.';
      const system=payload.messages.findIndex(message=>message.role==='system'&&typeof message.content==='string');
      body.messages=payload.messages.map((message,index)=>index===system?{...message,content:message.content+suffix}:message);
      if(system<0)body.messages=[{role:'system',content:suffix.trim()},...body.messages];
    }
    if(profile.startsWith('deep-math-')||profile==='concise-deep-256') {
      const budget=profile==='concise-deep-256'?256:Number(profile.slice('deep-math-'.length));
      // Leave at least 1024 tokens for the answer within a bounded total output allowance.
      body.max_tokens=Math.min(2304,Math.max(1536,Number.isSafeInteger(payload.max_tokens)?payload.max_tokens:1800));
      body.chat_template_kwargs={...(payload.chat_template_kwargs||{}),enable_thinking:true};
      body.reasoning_format='deepseek';body.reasoning_budget_tokens=budget;
    } else {
      body.chat_template_kwargs={...(payload.chat_template_kwargs||{}),enable_thinking:false};
    }
  }
  body.lora=scales.map((scale,id)=>({id,scale}));
  return {body,scales,profile};
}
module.exports={validateConfig,applyProfile};
