const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { killTree } = require('./commands.cjs');

function validateWave(value) {
  if (!(value instanceof Uint8Array) || value.byteLength < 44 + 9600 || value.byteLength > 44 + 16000 * 2 * 60) {
    throw new Error('Record between 0.3 and 60 seconds of audio.');
  }
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
      bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.readUInt32LE(16) !== 16 ||
      bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== 16000 ||
      bytes.readUInt32LE(28) !== 32000 || bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16 ||
      bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(40) !== bytes.length - 44 || (bytes.length - 44) % 2) {
    throw new Error('The recording must be mono 16 kHz PCM audio.');
  }
  return bytes;
}

class Voice {
  constructor(directory, temporaryDirectory) {
    this.directory = directory;
    this.temporaryDirectory = temporaryDirectory;
    this.active = null;
    this.finished = Promise.resolve();
    this.synthesis = null;
    this.speechFinished = Promise.resolve();
  }
  async status() {
    let hindiReady = false;
    try {
      await Promise.all(['hindi-runtime/Scripts/python.exe', 'hindi/speak.py', 'hindi/english-speech.ps1', 'hindi/hi_IN-pratham-medium.onnx',
        'hindi/hi_IN-pratham-medium.onnx.json'].map(file => fs.access(path.join(this.directory, file))));
      hindiReady = true;
    } catch {}
    try {
      await fs.access(path.join(this.directory, 'runtime', 'Release', 'whisper-cli.exe'));
      await fs.access(path.join(this.directory, 'ggml-small-q5_1.bin'));
      return { ready: true, hindiReady };
    } catch { return { ready: false, hindiReady, message: 'The local speech runtime is missing. Check the Buji V2 voice folder.' }; }
  }
  cancel() {
    this.active?.abort();
    this.cancelSpeech();
  }
  cancelSpeech() {
    this.synthesis?.abort();
  }
  async synthesize(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('Provide between 1 and 4,000 characters to read aloud.');
    if (this.synthesis) throw new Error('Finish or stop the current Hindi speech request.');
    const controller = new AbortController();
    this.synthesis = controller;
    let finish;
    this.speechFinished = new Promise(resolve => { finish = resolve; });
    const output = path.join(this.temporaryDirectory, randomUUID() + '.wav');
    try {
      if (!(await this.status()).hindiReady) throw new Error('The local Hindi voice is unavailable. Check the Buji voice folder.');
      await fs.mkdir(this.temporaryDirectory, { recursive: true });
      controller.signal.throwIfAborted();
      await new Promise((resolve, reject) => {
        const child = spawn(path.join(this.directory, 'hindi-runtime', 'Scripts', 'python.exe'),
          ['-I', path.join(this.directory, 'hindi', 'speak.py'), path.join(this.directory, 'hindi', 'hi_IN-pratham-medium.onnx'), output],
          { windowsHide: true, cwd: this.directory, stdio: ['pipe', 'ignore', 'ignore'] });
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify({ text }), 'utf8');
        const cancel = () => killTree(child);
        controller.signal.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(() => { controller.abort(); }, 120000);
        const clean = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel); };
        child.once('error', error => { clean(); reject(error); });
        child.once('close', code => {
          clean();
          if (controller.signal.aborted) reject(new Error('Hindi speech cancelled.'));
          else if (code !== 0) reject(new Error('Local Hindi speech synthesis failed.'));
          else resolve();
        });
      });
      controller.signal.throwIfAborted();
      if ((await fs.stat(output)).size > 24 * 1024 * 1024) throw new Error('The generated speech exceeded the playback limit.');
      return await fs.readFile(output);
    } finally {
      try { await fs.rm(output, { force: true }); }
      finally { if (this.synthesis === controller) this.synthesis = null; finish(); }
    }
  }
  async transcribe(value, language) {
    if (this.active) throw new Error('Finish or cancel the current transcription.');
    if (!['auto', 'en', 'hi'].includes(language)) throw new Error('Choose Auto, English, or Hindi for speech input.');
    const wave = validateWave(value);
    const controller = new AbortController();
    this.active = controller;
    let finish;
    this.finished = new Promise(resolve => { finish = resolve; });
    const basename = path.join(this.temporaryDirectory, randomUUID());
    const recording = basename + '.wav';
    const resultPath = basename + '.json';
    try {
      const status = await this.status();
      if (!status.ready) throw new Error(status.message);
      await fs.mkdir(this.temporaryDirectory, { recursive: true });
      controller.signal.throwIfAborted();
      await fs.writeFile(recording, wave, { flag: 'wx' });
      controller.signal.throwIfAborted();
      await new Promise((resolve, reject) => {
        const child = spawn(path.join(this.directory, 'runtime', 'Release', 'whisper-cli.exe'),
          ['-m', path.join(this.directory, 'ggml-small-q5_1.bin'), '-f', recording, '-l', language, '-t', '4',
            '-ng', '-nt', '-np', '-oj', '-of', basename],
          { windowsHide: true, cwd: this.directory, stdio: 'ignore' });
        let timedOut = false;
        const cancel = () => child.kill();
        controller.signal.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, 120000);
        const clean = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel); };
        child.once('error', error => { clean(); reject(error); });
        child.once('close', code => {
          clean();
          if (controller.signal.aborted) reject(new Error('Transcription cancelled.'));
          else if (timedOut) reject(new Error('Speech recognition took too long. Try a shorter recording.'));
          else if (code !== 0) reject(new Error('Local speech recognition failed. Try recording again.'));
          else resolve();
        });
      });
      controller.signal.throwIfAborted();
      const result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
      const text = result.transcription?.map(segment => segment.text).join(' ').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 10000) throw new Error('No clear speech was detected. Try again.');
      return { text, language: result.result?.language || language };
    } finally {
      try { await Promise.all([recording, resultPath].map(file => fs.rm(file, { force: true }))); }
      finally { if (this.active === controller) this.active = null; finish(); }
    }
  }
}

module.exports = { Voice, validateWave };
