'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '../../..');
  const output = path.join(root, 'outputs/BujiV2-Router');
  const artifacts = path.resolve(__dirname, '../artifacts');
  const sample = path.join(artifacts, 'voice-sample.wav');
  await fs.access(sample);
  const profile = await fs.mkdtemp(path.join(artifacts, 'voice-desktop-'));
  await fs.writeFile(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, projects: [], threads: [], settings: {
    endpoint: 'http://127.0.0.1:8093/v1', model: 'buji-v2-routed', backendScript: path.join(output, 'Start-Buji-V2-Backend.ps1'),
    autoStartModel: false, approveCommands: true, accessMode: 'sandbox', voiceLanguage: 'auto', voiceConversation: true, voiceURI: '', theme: 'light'
  } }));
  const env = { ...process.env, BUJI_DATA_DIR: profile, BUJI_HEADLESS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.BUJI_EXECUTABLE || path.join(output, 'app/BujiV2.exe');
  const args = ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${sample}`, '--autoplay-policy=no-user-gesture-required'];
  const launch = () => electron.launch({ executablePath, args, env, timeout: 45000 });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Record voice message', exact: true }).waitFor();
    const snapshot = await page.evaluate(() => window.buji.bootstrap());
    assert.equal(snapshot.voice.ready, true);
    assert.equal(snapshot.health.model, 'buji-v2-routed');
    await page.waitForFunction(() => speechSynthesis.getVoices().some(voice => voice.localService), undefined, { polling: 300, timeout: 15000 });
    await page.evaluate(() => {
      window.bujiVoicePlayback = [];
      const speak = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = utterance => {
        window.bujiVoicePlayback.push({ text: utterance.text, local: utterance.voice.localService, started: false, ended: false });
        const record = window.bujiVoicePlayback.at(-1);
        utterance.volume = 0;
        utterance.addEventListener('start', () => { record.started = true; });
        utterance.addEventListener('end', () => { record.ended = true; });
        return speak(utterance);
      };
    });
    await assert.rejects(page.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true })), /denied|permission/i);
    await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
    await page.getByRole('button', { name: 'Send voice message', exact: true }).waitFor();
    await page.waitForTimeout(4200);
    await page.getByRole('button', { name: 'Send voice message', exact: true }).click();
    await page.locator('.message.assistant .markdown').last().waitFor({ timeout: 90000 });
    const saved = JSON.parse(await fs.readFile(path.join(profile, 'workspace.json'), 'utf8'));
    const messages = saved.threads[0].messages;
    assert.match(messages.find(message => message.role === 'user').content, /2\s*\+\s*2|two plus two/i);
    assert.match(await page.locator('.message.assistant .markdown').last().innerText(), /\b4\b|four/i);
    await page.waitForFunction(() => window.bujiVoicePlayback.some(record => record.started && record.ended), undefined, { polling: 300, timeout: 15000 });
    assert.ok((await page.evaluate(() => window.bujiVoicePlayback)).every(record => record.local));
    const tempFiles = await fs.readdir(path.join(profile, 'voice-tmp'));
    assert.deepEqual(tempFiles, []);
    console.log('Recorded fixture through the mic UI, transcribed locally, got a real OmniCoder reply and played it with a local Windows voice.');

    const before = saved.threads[0].messages.length;
    await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
    await page.getByRole('button', { name: 'Send voice message', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel recording', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Record voice message"]'));
    assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'workspace.json'), 'utf8')).threads[0].messages.length, before);
    console.log('Cancelling a recording preserved chat history.');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Speech input language' }).selectOption('en');
    await page.getByRole('checkbox', { name: 'Voice conversation', exact: false }).uncheck();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
    await page.getByRole('button', { name: 'Use recording', exact: true }).waitFor();
    await page.waitForTimeout(4200);
    await page.getByRole('button', { name: 'Use recording', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Message Buji"]').value.includes('2'), undefined,
      { polling: 300, timeout: 60000 });
    assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'workspace.json'), 'utf8')).threads[0].messages.length, before);
    console.log('Dictation mode produced an editable draft without sending it.');
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    const restored = await page.evaluate(() => window.buji.bootstrap());
    assert.equal(restored.settings.voiceConversation, false);
    assert.equal(restored.settings.voiceLanguage, 'en');
    console.log('Voice preferences survived app restart.');
  } finally {
    await app.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
