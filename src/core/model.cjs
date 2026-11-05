const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function endpointUrl(endpoint, suffix = '') {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname))
    throw new Error('Use a localhost model endpoint. This app sends project context only to a local model.');
  return url.toString().replace(/\/$/, '') + suffix;
}
async function health(settings) {
  try {
    const response = await fetch(endpointUrl(settings.endpoint, '/models'), { redirect: 'error', signal: AbortSignal.timeout(3500) });
    if (!response.ok) throw new Error('The local model API returned ' + response.status);
    const data = await response.json();
    const found = data.data?.find(model => model.id === settings.model);
    if (!found) return { online: false, message: 'Expected model is not loaded.', models: data.data?.map(m => m.id) || [] };
    return { online: true, model: found.id, message: 'Local model is ready' };
  } catch (error) { return { online: false, message: error.message }; }
}
function findBackend(appPath, executablePath) {
  const candidates = [];
  for (const start of [appPath, path.dirname(executablePath)]) {
    let directory = start;
    for (let level = 0; level < 7; level++) {
      candidates.push(path.join(directory, 'Qwen3-Personal-WSP', 'Start-Qwen3.ps1'),
        path.join(directory, 'outputs', 'Qwen3-Personal-WSP', 'Start-Qwen3.ps1'),
        path.join(directory, 'BujiModel', 'Start-Model.ps1'),
        path.join(directory, 'backend', 'Start-Model.ps1'),
        path.join(directory, 'models', 'backend', 'Start-Model.ps1'));
      const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
    }
  }
  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}
async function startBackend(settings, onStatus = () => {}) {
  const current = await health(settings);
  if (current.online) return current;
  if (!settings.backendScript || !fs.existsSync(settings.backendScript))
    throw new Error('Select Start-Qwen3.ps1 in Settings, or start your Qwen model first.');
  onStatus({ online: false, loading: true, message: 'Starting your local model…' });
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', settings.backendScript, '-NoBrowser'],
      { windowsHide: true, cwd: path.dirname(settings.backendScript), stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', text => { log = (log + text).slice(-5000); });
    child.stderr.on('data', text => { log = (log + text).slice(-5000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Model startup took too long. ' + log)); }, 150000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(log || 'Model startup failed.')); });
  });
  const result = await health(settings);
  if (!result.online) throw new Error(result.message);
  return result;
}

function compactMessages(messages, budget = 14000) {
  const rejectedCalls = new Set();
  messages = messages.flatMap(message => {
    if (message.role === 'assistant' && message.tool_calls?.some(call => {
      try { const args = JSON.parse(call.function.arguments || '{}'); return !args || typeof args !== 'object' || Array.isArray(args); }
      catch { return true; }
    })) {
      for (const call of message.tool_calls) rejectedCalls.add(call.id);
      return [{ role: 'assistant', content: 'An earlier tool response had malformed arguments. Inspect the current files before continuing; its requested work must not be assumed complete.' }];
    }
    return message.role === 'tool' && rejectedCalls.has(message.tool_call_id) ? [] : [message];
  });
  const groups = [];
  for (const message of messages) {
    if (message.role === 'user' || !groups.length) groups.push([]);
    groups.at(-1).push(message);
  }
  let used = 0, selected = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const cost = JSON.stringify(groups[i]).replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[image]').length;
    if (selected.length && used + cost > budget) break;
    selected.unshift(...groups[i]); used += cost;
  }
  const cost = value => JSON.stringify(value).replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[image]').length;
  selected = selected.map(message => message.role === 'tool' && message.content.length > 3500
    ? { ...message, content: message.content.slice(0, 2600) + '\n[Output shortened for context]\n' + message.content.slice(-700) }
    : message);
  while (cost(selected) > budget) {
    const first = selected.findIndex(message => message.role === 'assistant' && message.tool_calls?.length);
    if (first < 0) break;
    let end = first + 1;
    while (end < selected.length && selected[end].role === 'tool') end++;
    const names = selected[first].tool_calls.map(call => call.function.name).join(', ');
    const summary = selected.slice(first + 1, end).map(message => message.content.slice(0, 450)).join('\n');
    selected.splice(first, end - first, { role: 'assistant', content: `Earlier tool work (${names}):\n${summary}` });
  }
  return selected;
}
async function complete(settings, messages, tools, signal, onText, options = {}) {
  const response = await fetch(endpointUrl(settings.endpoint, '/chat/completions'), {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ model: settings.model, messages, ...(tools.length ? { tools, tool_choice: options.toolChoice || 'auto' } : {}),
      temperature: .25, top_p: .8, top_k: 20, max_tokens: 1800, stream: true,
      stream_options: { include_usage: true }, parallel_tool_calls: false })
  });
  if (!response.ok) throw new Error((await response.text()).slice(0, 1500));
  let content = '', buffer = '', timings = null, usage = null;
  const calls = new Map();
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim(); if (!data || data === '[DONE]') continue;
      const event = JSON.parse(data); if (event.error) throw new Error(event.error.message || JSON.stringify(event.error));
      if (event.timings) timings = event.timings;
      if (event.usage) usage = event.usage;
      const delta = event.choices?.[0]?.delta;
      if (delta?.content) { content += delta.content; onText?.(delta.content); }
      for (const part of delta?.tool_calls || []) {
        const key = part.index ?? 0;
        const call = calls.get(key) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        calls.set(key, call);
      }
    }
  }
  let toolCalls = [...calls.values()], invalidToolCall = false;
  // Some local chat templates emit literal tool tags instead of structured deltas.
  if (tools.length && !toolCalls.length && content.includes('<tool_call>')) {
    const expressions = [...content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)];
    if (!expressions.length) invalidToolCall = true;
    for (const expression of expressions) {
      let value; try { value = JSON.parse(expression[1]); } catch { invalidToolCall = true; continue; }
      toolCalls.push({ id: 'local-' + crypto.randomUUID(), type: 'function', function: {
        name: value.name, arguments: JSON.stringify(value.arguments || {}) } });
    }
    if (toolCalls.length) content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
  }
  return { content, toolCalls, invalidToolCall, timings, usage };
}
module.exports = { endpointUrl, health, startBackend, findBackend, compactMessages, complete };
