'use strict';
const http = require('node:http');
const { route } = require('./router.cjs');
const { applyProfile } = require('./profile.cjs');
const { arithmetic } = require('./arithmetic.cjs');
const crypto = require('node:crypto');

const MODEL_ID = 'buji-v2-routed';
const MAX_BODY = 12 * 1024 * 1024;

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function gateway({ nativePort, nativeApiKey, ready, mathScales, originalOnly = false, brainConfig }) {
  return http.createServer(async (req, res) => {
    const host = req.headers.host;
    if (req.headers.origin || !['127.0.0.1', 'localhost', `127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`].includes(host)) {
      return json(res, 403, { error: { message: 'This endpoint accepts local desktop clients.' } });
    }
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, ready() ? 200 : 503, { status: ready() ? 'ok' : 'loading', model: MODEL_ID, profile: originalOnly ? 'original' : 'automatic', brain:brainConfig?.profile||'current-wsp',context:brainConfig?.context||4096 });
    }
    if (!ready()) return json(res, 503, { error: { message: 'OmniCoder is loading.' } });
    if (req.method === 'GET' && req.url === '/v1/models') {
      return json(res, 200, { object: 'list', data: [{ id: MODEL_ID, object: 'model', owned_by: 'local' }] });
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(res, 404, { error: { message: 'Unknown endpoint.' } });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      return json(res, 415, { error: { message: 'Use application/json.' } });
    }

    let payload;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > MAX_BODY) {
          res.setHeader('Connection', 'close');
          return json(res, 413, { error: { message: 'Request too large.' } });
        }
        chunks.push(chunk);
      }
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      if (!res.destroyed) json(res, 400, { error: { message: 'Invalid JSON.' } });
      return;
    }
    if (!payload || !Array.isArray(payload.messages) || payload.model !== MODEL_ID) {
      return json(res, 400, { error: { message: `Supply messages and model ${MODEL_ID}.` } });
    }
    if (payload.messages.some(message => Array.isArray(message?.content) && message.content.some(part => part?.type !== 'text'))) {
      return json(res, 400, { error: { message: 'The OmniCoder V2 profile accepts text messages.' } });
    }

    const decision = originalOnly ? { name: 'original', reason: 'benchmark-control' } : route(payload.messages, payload.tool_choice);
    const latest=payload.messages.findLast(message=>message?.role==='user');
    const exact=!originalOnly&&decision.name==='math-wsp'&&!payload.tools?.length&&!payload.response_format&&arithmetic(latest?.content);
    if(exact) {
      const headers={'Cache-Control':'no-store','X-Buji-Route':'calculator','X-Buji-Brain':'exact-local-arithmetic','X-Buji-Adapter-Scales':'0,0'};
      const id='chatcmpl-local-'+crypto.randomUUID(),created=Math.floor(Date.now()/1000),usage={prompt_tokens:0,completion_tokens:0,total_tokens:0};
      if(payload.stream) {
        res.writeHead(200,{'Content-Type':'text/event-stream',...headers});
        for(const event of [{choices:[{index:0,delta:{role:'assistant',content:exact.answer},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'stop'}]},{choices:[],usage}])res.write('data: '+JSON.stringify({id,created,model:MODEL_ID,object:'chat.completion.chunk',...event})+'\n\n');
        return res.end('data: [DONE]\n\n');
      }
      res.writeHead(200,{'Content-Type':'application/json',...headers});
      return res.end(JSON.stringify({id,created,model:MODEL_ID,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:exact.answer},finish_reason:'stop'}],usage,buji:{source:exact.source}}));
    }
    const refined = applyProfile(payload,decision,brainConfig,originalOnly);
    // Preserve the previously verified adapter configuration for the legacy math path.
    if(refined.profile==='current-wsp') {refined.scales=mathScales;refined.body.lora=mathScales.map((scale,id)=>({id,scale}));}
    const scales=refined.scales;
    const body = JSON.stringify(refined.body);
    const upstream = http.request({ host: '127.0.0.1', port: nativePort, path: '/v1/chat/completions', method: 'POST',
      headers: { Authorization: `Bearer ${nativeApiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
      res.writeHead(response.statusCode || 502, {
        'Content-Type': response.headers['content-type'] || 'application/json',
        'Cache-Control': 'no-store', 'X-Buji-Route': decision.name, 'X-Buji-Route-Reason': decision.reason,
        'X-Buji-Adapter-Scales': scales.join(','),'X-Buji-Brain':refined.profile
      });
      response.on('error', error => res.destroy(error));
      response.pipe(res);
    });
    upstream.setTimeout(300000, () => upstream.destroy(new Error('OmniCoder timed out')));
    upstream.on('error', () => {
      if (res.destroyed) return;
      if (res.headersSent) res.destroy();
      else json(res, 502, { error: { message: 'Could not complete the local OmniCoder request.' } });
    });
    res.on('close', () => upstream.destroy());
    upstream.end(body);
  });
}

module.exports = { gateway, MODEL_ID };
