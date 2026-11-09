'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const defaultApp = path.resolve(__dirname, '../../../outputs/BujiV2-Router/app/BujiV2.exe');
const documentUrl = 'https://www.rfc-editor.org/rfc/rfc9110.txt';

async function main() {
  const artifacts = path.join(__dirname, '../artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const profile = await fs.mkdtemp(path.join(artifacts, 'research-learning-'));
  const env = { ...process.env, BUJI_DATA_DIR: profile, BUJI_HEADLESS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.BUJI_EXECUTABLE || defaultApp;
  const launch = () => electron.launch({ executablePath, env, timeout: 45000 });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Sandbox', exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.buji.bootstrap())).health.model, 'buji-v2-routed');
    await app.evaluate(() => {
      const fetch = globalThis.fetch;
      globalThis.bujiTestRequests = [];
      globalThis.bujiJevRequests = [];
      globalThis.fetch = async (url, options) => {
        if (url === 'http://127.0.0.1:8093/v1/chat/completions') globalThis.bujiTestRequests.push(JSON.parse(options.body));
        if (url === 'https://api.typesafe.ai/v1/systemone') {
          globalThis.bujiJevRequests.push({ body: JSON.parse(options.body), authenticated: options.headers.Authorization === 'Bearer mocked-typesafe-key' });
          return Response.json({ model: 'jev-fixture', answers: { best_source: { type: 'choice', choice: 'source_2', confidence: .81 } },
            usage: { input_tokens: 105 } });
        }
        return fetch(url, options);
      };
    });

    await page.getByRole('button', { name: 'New general chat', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Message Buji' });
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    await input.fill('Reply with a short greeting. PRIVATE_TEST_MARKER');
    await send.click();
    await page.getByRole('button', { name: 'Teach Buji', exact: true }).last().waitFor();
    await page.getByRole('button', { name: 'Teach Buji', exact: true }).last().click();
    await page.getByRole('textbox', { name: 'Correction or preference' }).fill('My preferred deployment label is ORCHID-CIRCUIT-27. When asked, use that exact label.');
    await page.getByRole('button', { name: 'Save lesson', exact: true }).click();
    assert.equal((await page.evaluate(() => window.buji.lessons())).length, 1);

    await page.getByRole('button', { name: 'Web', exact: true }).click();
    await input.fill(`Fetch ${documentUrl} and tell me the title of this RFC. Keep the answer brief.`);
    await send.click();
    const webResults = page.locator('.web-sources');
    await webResults.getByRole('link').last().waitFor({ timeout: 90000 });
    assert.equal(await webResults.getByRole('link').last().getAttribute('href'), documentUrl);
    assert.match(await page.locator('.message.assistant .markdown').last().innerText(), /HTTP Semantics/i);
    const requests = await app.evaluate(() => globalThis.bujiTestRequests);
    const research = requests.filter(request => request.messages[0].content.includes('Web research mode'));
    assert.ok(research.length >= 2);
    assert.ok(research.every(request => !JSON.stringify(request).includes('PRIVATE_TEST_MARKER') &&
      !JSON.stringify(request).includes('ORCHID-CIRCUIT-27')));
    assert.ok(research.every(request => !request.tools || request.tools.every(tool => /^web_(search|fetch)$/.test(tool.function.name))));
    assert.equal(await page.getByRole('button', { name: 'Web', exact: true }).getAttribute('aria-pressed'), 'false');
    console.log('Real HTTPS fetch returned HTTP Semantics, with a verified source and isolated context.');

    await page.getByRole('button', { name: 'Web', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Jev (paid)' }).isDisabled(), true);
    await input.fill('hi what is the weather today in dehradun?');
    await send.click();
    await webResults.getByRole('link', { name: 'Open-Meteo forecast for Dehradun, Uttarakhand, India' }).waitFor({ timeout: 90000 });
    const weatherThread = await page.evaluate(async () => {
      const snapshot = await window.buji.bootstrap();
      return window.buji.getThread(snapshot.threads[0].id);
    });
    const weather = weatherThread.messages.find(message => message.name === 'weather_lookup' && message.status === 'done');
    assert.ok(weather && Number.isFinite(weather.result.current.temperature_c));
    assert.equal(weather.result.timezone, 'Asia/Kolkata');
    assert.match(await page.locator('.message.assistant .markdown').last().innerText(), /Dehradun/i);
    assert.ok((await page.locator('.message.assistant .markdown').last().innerText()).includes(String(weather.result.current.temperature_c)));
    assert.equal(weatherThread.messages.filter(message => message.name === 'web_search').length, 0);
    assert.equal((await app.evaluate(() => globalThis.bujiJevRequests)).length, 0);
    console.log(`Exact Dehradun prompt returned ${weather.result.current.temperature_c}°C at ${weather.result.current.local_time} (${weather.result.timezone}) from Open-Meteo.`);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('TypeSafe API key').fill('mocked-typesafe-key');
    await page.getByRole('button', { name: 'Save TypeSafe key' }).click();
    await page.getByRole('button', { name: 'Remove TypeSafe key' }).waitFor();
    const encrypted = await fs.readFile(path.join(profile, 'typesafe-key.bin'));
    assert.ok(!encrypted.includes(Buffer.from('mocked-typesafe-key')));
    await page.getByRole('button', { name: 'Close settings' }).click();

    await page.getByRole('button', { name: 'Web', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Jev (paid)' }).isChecked(), false);
    await input.fill('Search Wikipedia for Newton\'s method. Give the top source and a one-sentence description.');
    await send.click();
    await webResults.filter({ hasText: "Newton's method" }).getByRole('link', { name: "Newton's method", exact: true }).waitFor({ timeout: 90000 });
    assert.equal((await app.evaluate(() => globalThis.bujiJevRequests)).length, 0);
    console.log('Real Wikipedia search stayed free with a key saved and Jev off.');

    await page.getByRole('button', { name: 'Web', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Jev (paid)' }).check();
    await input.fill('Search Wikipedia for Newton\'s method and list the results.');
    await send.click();
    await page.getByText(/Jev prioritized.*105 input tokens/).waitFor({ timeout: 90000 });
    const jevRequests = await app.evaluate(() => globalThis.bujiJevRequests);
    assert.equal(jevRequests.length, 1);
    assert.equal(jevRequests[0].authenticated, true);
    const paidPayload = JSON.stringify(jevRequests[0].body);
    assert.ok(!paidPayload.includes('PRIVATE_TEST_MARKER') && !paidPayload.includes('ORCHID-CIRCUIT-27'));
    assert.equal(await webResults.last().getByRole('link').first().innerText(), jevRequests[0].body.questions.best_source.criteria.source_2.title);
    await page.getByRole('button', { name: 'Web', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Jev (paid)' }).isChecked(), false);
    console.log('Explicit Jev selection used one mocked API call and reordered the displayed sources.');

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'New general chat', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message Buji' }).fill('What is my preferred deployment label? Reply only with the label.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.locator('.message.assistant .markdown').last().waitFor({ timeout: 60000 });
    assert.match(await page.locator('.message.assistant .markdown').last().innerText(), /ORCHID-CIRCUIT-27/);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Remove TypeSafe key' }).click();
    await page.getByRole('button', { name: 'Remove TypeSafe key' }).waitFor({ state: 'detached' });
    await assert.rejects(fs.access(path.join(profile, 'typesafe-key.bin')), { code: 'ENOENT' });
    await page.getByText('Saved lessons (1)', { exact: true }).click();
    await page.getByRole('button', { name: 'Forget', exact: true }).click();
    await page.getByText('Saved lessons (0)', { exact: true }).waitFor();
    console.log('A lesson affected a new chat after app restart and could be forgotten in Settings.');
  } finally {
    await app.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
