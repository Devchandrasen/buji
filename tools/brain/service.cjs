'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const { gateway, MODEL_ID } = require('./gateway.cjs');
const { validateConfig } = require('./profile.cjs');

const root = path.resolve(__dirname, '..', '..');
const installed = Boolean(process.env.BUJI_RELEASE_ASSETS);
const installRoot = path.resolve(__dirname, '..', '..');
const assets = process.env.BUJI_RELEASE_ASSETS;
const parentPid = Number(process.env.BUJI_RELEASE_PARENT_PID);
const stateDir = installed ? path.join(assets, 'serving') : path.join(root, 'work', 'buji-v2-router', 'serving');
const statePath = path.join(stateDir, 'state.json');
const cuda = installed && process.env.BUJI_RELEASE_CUDA === '1';
const runtime = installed ? (cuda ? path.join(assets, 'cuda') : path.join(installRoot, 'runtime')) :
  path.join(root, 'outputs', 'Qwen3-Personal-WSP', 'runtime');
const v1 = path.dirname(runtime);
const wsp = installed ? path.join(installRoot, 'wsp') : path.join(root, 'outputs', 'OmniCoder-WSP2');
const model = installed ? path.join(assets, 'omni-parent-Q4_K_M.gguf') :
  path.join(root, 'outputs', 'BujiV2-Merge', 'models', 'omni-parent-Q4_K_M.gguf');
const nativePort = installed ? 18092 : 8092;
const routerPort = installed ? 18093 : 8093;
const brainFile=path.join(__dirname,'brain.json');
const brainConfig=validateConfig(fs.existsSync(brainFile)?JSON.parse(fs.readFileSync(brainFile,'utf8')):{});
const benchmark = process.argv.includes('--benchmark');
const key = crypto.randomBytes(24).toString('hex');
const keyPath = path.join(stateDir, `native-key-${process.pid}.txt`);
const stopPath = path.join(stateDir, `stop-${process.pid}`);

let engine;
let ready = false;
let pausedV1 = false;
let stopping = false;
let watcher;
const listeners = [];

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function state(status) {
  fs.writeFileSync(`${statePath}.${process.pid}.tmp`, JSON.stringify({ status, pid: process.pid, nativePid: engine?.pid,
    nativePort, benchmark, pausedV1, ...(!installed && { apiKey: key }), stopPath }, null, 2));
  fs.renameSync(`${statePath}.${process.pid}.tmp`, statePath);
}

function occupied(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1500, () => finish(true));
  });
}

async function getJson(port, endpoint, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(3000)
  });
  if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
  return response.json();
}

async function runPowerShell(file, args = []) {
  const log = fs.openSync(path.join(stateDir, 'backend-transitions.log'), 'a');
  try {
    const process = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
      { windowsHide: true, stdio: ['ignore', log, log] });
    const [exit] = await once(process, 'exit');
    if (exit !== 0) throw new Error(`Backend transition failed with exit code ${exit}. See backend-transitions.log.`);
  } finally {
    fs.closeSync(log);
  }
}

async function verifyAdapters() {
  const decision = readJson(path.join(wsp, 'decision.json'));
  const manifest = readJson(path.join(wsp, 'weight-edit-manifest.json'));
  const scales = decision.selected_candidate.scales;
  if (decision.selected_candidate.name !== 'both-0.5' || scales?.length !== 2 || scales.some(scale => scale !== 0.5)) {
    throw new Error('The evaluated math adapter configuration has changed.');
  }
  const paths = [];
  for (const name of ['repair-upgate.gguf', 'repair-down.gguf']) {
    const file = path.join(wsp, 'adapters', name);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== manifest.adapters.find(adapter => adapter.name === name)?.sha256) {
      throw new Error(`Adapter hash mismatch for ${name}.`);
    }
    paths.push(file);
  }
  return { paths, scales };
}

async function close(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  ready = false;
  clearInterval(watcher);
  for (const server of listeners) {
    server.close();
    server.closeAllConnections();
  }
  try {
    if (engine?.pid && engine.exitCode === null && engine.signalCode === null) {
      const exited = once(engine, 'exit');
      engine.kill();
      await Promise.race([exited, sleep(10000)]);
      if (engine.exitCode === null && engine.signalCode === null) throw new Error('OmniCoder did not exit.');
    }
    if (pausedV1) {
      await runPowerShell(path.join(v1, 'Start-Qwen3.ps1'), ['-NoBrowser']);
      pausedV1 = false;
    }
  } catch (error) {
    console.error(error.message);
    exitCode = 1;
  }
  if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
  state(exitCode ? 'failed' : 'stopped');
  process.exit(exitCode);
}

async function start() {
  fs.mkdirSync(stateDir, { recursive: true });
  const { paths, scales } = await verifyAdapters();
  for (const [port, originalOnly] of [[routerPort, false], ...(benchmark ? [[8094, true]] : [])]) {
    const server = gateway({ nativePort, nativeApiKey: key, ready: () => ready, mathScales: scales, originalOnly, brainConfig });
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    listeners.push(server);
  }
  state('loading');
  if (await occupied(nativePort)) throw new Error('The internal model port is occupied.');
  if (!installed && await occupied(8088)) {
    const models = await getJson(8088, '/v1/models');
    if (!models.data?.some(entry => entry.id === 'qwen3-personal-wsp')) throw new Error('An unfamiliar model uses port 8088.');
    const slots = await getJson(8088, '/slots');
    if (!Array.isArray(slots) || slots.some(slot => slot.is_processing)) throw new Error('Wait for the current Buji V1 request to finish.');
    await runPowerShell(path.join(v1, 'Stop-Qwen3.ps1'));
    pausedV1 = true;
  }
  const args = ['--model', model, '--alias', MODEL_ID, '--host', '127.0.0.1', '--port', String(nativePort),
    '--n-gpu-layers', installed && !cuda ? '0' : '99', '--ctx-size', String(brainConfig.context), '--parallel', '1', '--flash-attn', 'on', '--cache-type-k', 'q8_0',
    '--cache-type-v', 'q8_0', '--batch-size', '512', '--ubatch-size', '256', '--threads', '8', '--jinja',
    '--reasoning', 'off', '--cache-ram', '0', '--slots', '--slot-save-path', stateDir, '--lora-init-without-apply',
    '--api-key-file', keyPath];
  for (const file of paths) args.push('--lora', file);
  const nativeLog = fs.openSync(path.join(stateDir, 'omnicoder.log'), 'a');
  try {
    fs.writeFileSync(keyPath, `${key}\n`, { flag: 'wx' });
    engine = spawn(path.join(runtime, 'llama-server.exe'), args, { cwd: runtime, windowsHide: true,
      stdio: ['ignore', nativeLog, nativeLog] });
    await once(engine, 'spawn');
  } finally {
    fs.closeSync(nativeLog);
  }
  state('loading');
  const headers = { Authorization: `Bearer ${key}` };
  const deadline = Date.now() + 105000;
  let loaded = false;
  while (Date.now() < deadline && engine.exitCode === null && engine.signalCode === null && !fs.existsSync(stopPath)) {
    try {
      loaded = (await getJson(nativePort, '/health', { headers })).status === 'ok';
      if (loaded) break;
    } catch {}
    await sleep(500);
  }
  if (!loaded) throw new Error('OmniCoder failed to become ready. See omnicoder.log.');
  const zero = [{ id: 0, scale: 0 }, { id: 1, scale: 0 }];
  await getJson(nativePort, '/lora-adapters', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(zero) });
  const adapters = await getJson(nativePort, '/lora-adapters', { headers });
  if (adapters.length !== 2 || adapters.some((adapter, id) => adapter.id !== id || adapter.scale !== 0 || path.resolve(adapter.path) !== paths[id])) {
    throw new Error('Native adapter configuration differs from the verified files.');
  }
  if ((await fetch(`http://127.0.0.1:${nativePort}/v1/models`, { signal: AbortSignal.timeout(2500) })).status !== 401) {
    throw new Error('The internal model API must require its local service key.');
  }
  ready = true;
  state('ready');
  console.log(`Buji is ready at http://127.0.0.1:${routerPort}/v1${benchmark ? ' with benchmark control on 8094' : ''}.`);
  engine.once('exit', () => { if (!stopping) close(1); });
  watcher = setInterval(() => {
    if (fs.existsSync(stopPath)) { close(); return; }
    if (installed && parentPid > 0) {
      try { process.kill(parentPid, 0); }
      catch (error) { if (error.code === 'ESRCH') close(); }
    }
  }, 350);
  process.once('SIGINT', () => close());
  process.once('SIGTERM', () => close());
}

start().catch(error => {
  console.error(error.stack || error.message);
  if (listeners.length && listeners[0].listening) close(1);
  else process.exit(1);
});
