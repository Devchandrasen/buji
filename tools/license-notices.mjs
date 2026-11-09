import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
const notices = ['# Third-party notices', '', 'Buji application code is MIT-licensed. Dependencies and models retain their upstream licenses.', '',
  'The following inventory is generated from the locked production dependencies. Full available notices are reproduced in `docs/licenses/` and in the application distribution.', '',
  '| Package | Version | License |', '| --- | --- | --- |'];
const full = ['Buji V1 — third-party production dependency notices', ''];
const inventory = [];
const licenseDirectory = path.join(root, 'docs', 'licenses');
await fs.mkdir(licenseDirectory, { recursive: true });
for (const [location, record] of Object.entries(lock.packages || {})) {
  if (!location.startsWith('node_modules/') || record.dev) continue;
  const directory = path.join(root, location);
  let pkg; try { pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')); } catch { continue; }
  const entry = { name: pkg.name, version: pkg.version, license: pkg.license || record.license || 'See upstream',
    repository: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || pkg.homepage || '' };
  inventory.push(entry);
  const filename = pkg.name.replaceAll('/', '__').replaceAll('@', '') + '-' + pkg.version + '.txt';
  const sections = [];
  for (const file of await fs.readdir(directory)) {
    if (!/^(licen[cs]e|notice|copyright)(\.|$)/i.test(file)) continue;
    const candidate = path.join(directory, file); if (!(await fs.stat(candidate)).isFile()) continue;
    sections.push(await fs.readFile(candidate, 'utf8'));
  }
  if (sections.length) {
    await fs.writeFile(path.join(licenseDirectory, filename), sections.join('\n\n'));
    notices.push(`| [${entry.name}](docs/licenses/${filename}) | ${entry.version} | ${entry.license} |`);
    full.push('='.repeat(72), entry.name + ' ' + entry.version + ' — ' + entry.license, '', ...sections, '');
  } else notices.push(`| ${entry.name} | ${entry.version} | ${entry.license} |`);
}
notices.push('', 'Electron and Chromium notices are included with the Windows runtime. The optional Qwen model recipe is described in `tools/model/README.md`; its base checkpoint is Apache-2.0. No model weights are part of the app repository.', '');
notices.push('Optional visual computer-use components and their licenses are documented in [Visual runtime notices](docs/vision-third-party-notices.md).', '');
full.push(await fs.readFile(path.join(root, 'docs', 'vision-third-party-notices.md'), 'utf8'));
await fs.writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), notices.join('\n'));
await fs.writeFile(path.join(root, 'docs', 'dependencies.json'), JSON.stringify(inventory, null, 2)+'\n');
await fs.mkdir(path.join(root, 'dist'), { recursive: true });
await fs.writeFile(path.join(root, 'dist', 'THIRD_PARTY_LICENSES.txt'), full.join('\n'));
console.log('Recorded notices for', inventory.length, 'production dependencies.');
