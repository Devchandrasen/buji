const { spawn } = require('node:child_process');
const { safePath } = require('./workspace.cjs');
const path = require('node:path');

function killTree(child) {
  if (!child || child.exitCode !== null || !Number.isSafeInteger(child.pid)) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else child.kill('SIGTERM');
}
async function runCommand(root, command, { cwd = '.', timeout = 60000, signal, onOutput = () => {} } = {}) {
  if (typeof command !== 'string' || !command.trim() || command.length > 8000)
    throw new Error('Provide a command between 1 and 8000 characters.');
  const directory = await safePath(root, cwd);
  if (signal?.aborted) throw new Error('Command cancelled.');
  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const args = process.platform === 'win32'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; ' + command]
      : ['-c', command];
    const child = spawn(shell, args, { cwd: directory, windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', GIT_PAGER: 'cat', TERM: 'dumb' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false, cancelled = false;
    const append = (chunk, stream) => {
      const text = chunk.toString('utf8'); output = (output + text).slice(-120000); onOutput(text, stream);
    };
    child.stdout.on('data', chunk => append(chunk, 'stdout'));
    child.stderr.on('data', chunk => append(chunk, 'stderr'));
    const abort = () => { cancelled = true; killTree(child); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, Math.max(1000, Math.min(timeout, 300000)));
    child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      resolve({ command, cwd: path.relative(root, directory) || '.', exitCode: code,
        output, timedOut, cancelled });
    });
  });
}
module.exports = { runCommand };
