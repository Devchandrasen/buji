import { packager } from '@electron/packager';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
let workspaceRoot = root;
for (let cursor = root; ; cursor = path.dirname(cursor)) {
  try { await fs.access(path.join(cursor, 'work')); await fs.access(path.join(cursor, 'outputs')); workspaceRoot = cursor; break; } catch {}
  if (path.dirname(cursor) === cursor) break;
}
const packagingWork = path.join(workspaceRoot, 'work', 'buji-packaging');
const stage = path.join(packagingWork, 'stage');
const packageOutput = path.join(packagingWork, 'packages');
const deliverable = path.join(workspaceRoot, 'outputs', 'BujiV1');
const sourceCopyOptions = { recursive: true,
  filter: filename => path.basename(filename) !== '__pycache__' && !filename.endsWith('.pyc') };
for (const candidate of [stage, packageOutput]) {
  if (!candidate.toLowerCase().startsWith(path.join(workspaceRoot, 'work').toLowerCase() + path.sep))
    throw new Error('Packaging path is outside this workspace: ' + candidate);
}
await fs.mkdir(stage, { recursive: true });
await fs.mkdir(deliverable, { recursive: true });
await fs.cp(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });
await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({
  name: 'buji', productName: 'Buji V1', version: manifest.version, main: 'dist/main.cjs',
  description: 'Your local coding workspace, powered by Qwen3 Personal WSP' }, null, 2));
const options = { dir: stage, out: packageOutput, name: 'Buji V1', executableName: 'Buji',
  platform: 'win32', arch: 'x64', electronVersion: '45.2.2', asar: true,
  icon: path.join(root, 'assets', 'buji.ico'), overwrite: true,
  appVersion: manifest.version, appCopyright: 'Copyright 2026 Dr Chandrasen Pandey and Buji contributors',
  win32metadata: { CompanyName: 'Buji contributors', FileDescription: 'Buji V1 local coding desktop',
    ProductName: 'Buji V1', InternalName: 'Buji V1', OriginalFilename: 'Buji.exe' } };
const zipName = 'electron-v45.2.2-win32-x64.zip';
async function findZip(directory, depth = 0) {
  if (depth > 4) return null;
  let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === zipName) return filename;
    if (entry.isDirectory()) { const found = await findZip(filename, depth + 1); if (found) return found; }
  }
  return null;
}
const cached = await findZip(path.join(process.env.LOCALAPPDATA, 'electron', 'Cache'));
if (cached) {
  const cache = path.join(packagingWork, 'electron-zip-cache'); await fs.mkdir(cache, { recursive: true });
  await fs.copyFile(cached, path.join(cache, zipName)); options.electronZipDir = cache;
} else options.download = { cacheRoot: path.join(packagingWork, 'electron-cache') };
console.log('Packaging in', packageOutput);
const directories = await packager(options);
const destination = path.join(deliverable, 'app');
try {
  await fs.access(destination);
  const previous = path.join(packagingWork, 'previous-app-' + Date.now());
  if (!destination.startsWith(path.join(workspaceRoot, 'outputs') + path.sep) || !previous.startsWith(packagingWork + path.sep))
    throw new Error('Unexpected package replacement paths.');
  await fs.rename(destination, previous);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.cp(directories[0], destination, { recursive: true });
const source = path.join(deliverable, 'source'); await fs.mkdir(source, { recursive: true });
if (path.resolve(root) !== path.resolve(source))
  for (const name of ['src', 'tests', 'assets', 'tools', 'docs', '.github', '.gitignore', '.gitattributes', 'LICENSE', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'CHANGELOG.md', 'ROADMAP.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'build.mjs', 'package.mjs'])
    await fs.cp(path.join(root, name), path.join(source, name), sourceCopyOptions);
await fs.writeFile(path.join(deliverable, 'Start-Buji.cmd'), '@echo off\r\nstart "" "%~dp0app\\Buji.exe"\r\n');
for (const name of ['docs', 'tools', 'LICENSE', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'CHANGELOG.md', 'ROADMAP.md', 'THIRD_PARTY_NOTICES.md'])
  await fs.cp(path.join(root, name), path.join(deliverable, name), sourceCopyOptions);
console.log('Ready:', path.join(destination, 'Buji.exe'));
