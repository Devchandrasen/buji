'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function runCase(name, language, expected) {
  const root = path.resolve(__dirname, '../../..');
  const output = path.join(root, 'outputs/BujiV2-Router');
  const artifacts = path.resolve(__dirname, '../artifacts');
  const sample = path.join(artifacts, name + '.wav');
  const profile = await fs.mkdtemp(path.join(artifacts, 'hindi-desktop-'));
  await fs.writeFile(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, projects: [], threads: [], settings: {
    endpoint: 'http://127.0.0.1:8093/v1', model: 'buji-v2-routed', backendScript: path.join(output, 'Start-Buji-V2-Backend.ps1'),
    autoStartModel: false, approveCommands: true, accessMode: 'sandbox', voiceLanguage: 'auto', voiceReplyLanguage: language,
    voiceConversation: true, voiceURI: '', theme: 'light'
  } }));
  const env = { ...process.env, BUJI_DATA_DIR: profile, BUJI_HEADLESS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: process.env.BUJI_EXECUTABLE || path.join(output, 'app/BujiV2.exe'),
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${sample}`, '--autoplay-policy=no-user-gesture-required'], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Record voice message', exact: true }).waitFor();
    const status = await page.evaluate(() => window.buji.bootstrap());
    assert.equal(status.voice.hindiReady, true);
    assert.equal(status.health.model, 'buji-v2-routed');
    await app.evaluate(() => {
      const fetch = globalThis.fetch;
      globalThis.fetch = (url, options) => {
        if (!String(url).startsWith('http://127.0.0.1:8093/')) throw new Error('This speech test permits only the local model endpoint.');
        return fetch(url, options);
      };
    });
    await page.evaluate(() => {
      window.bujiHindiPlayback = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        const entry = { url: this.src, started: false, ended: false };
        window.bujiHindiPlayback.push(entry);
        this.volume = 0;
        this.addEventListener('playing', () => { entry.started = true; });
        this.addEventListener('ended', () => { entry.ended = true; });
        return play.call(this);
      };
    });
    await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
    await page.getByRole('button', { name: 'Send voice message', exact: true }).waitFor();
    await page.waitForTimeout(5000);
    await page.getByRole('button', { name: 'Send voice message', exact: true }).click();
    await page.locator('.message.assistant .markdown').last().waitFor({ timeout: 90000 });
    const answer = await page.locator('.message.assistant .markdown').last().innerText();
    assert.match(answer, /[\u0900-\u097f]/);
    assert.match(answer, expected);
    if (language === 'hinglish') assert.doesNotMatch(answer, /कोई ["“]?लिस्ट["”]? नहीं|मैं एक AI हूँ, न कि/);
    await page.waitForFunction(() => window.bujiHindiPlayback.some(item => item.started && item.ended), undefined,
      { polling: 300, timeout: 90000 });
    const playback = await page.evaluate(() => window.bujiHindiPlayback);
    assert.ok(playback.every(item => item.url.startsWith('blob:')));
    const saved = JSON.parse(await fs.readFile(path.join(profile, 'workspace.json'), 'utf8'));
    assert.match(saved.threads[0].messages.find(message => message.role === 'user').content, /[\u0900-\u097f]/);
    assert.deepEqual(await fs.readdir(path.join(profile, 'voice-tmp')), []);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: 'Voice reply language' }).inputValue(), language);
    assert.ok((await page.getByRole('combobox', { name: 'Reply voice' }).locator('option').allTextContents()).some(label => label.includes('Pratham Hindi')));
    console.log(name, 'recording -> Hindi transcription -> OmniCoder reply -> local Hindi audio passed.');
    console.log('Reply', answer);
  } finally {
    await app.close();
  }
}

(async () => {
  await runCase('hindi-question', 'hi', /मैं|आप|ठीक|नमस्ते|हूँ/);
  await runCase('hinglish-question', 'hinglish', /Python|पाइथन/i);
})().catch(error => { console.error(error); process.exitCode = 1; });
