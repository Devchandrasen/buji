const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPatch, diffLines } = require('diff');
const OMIT = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.next', 'dist', 'build', 'target', '.cache']);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const inside = (root, target) => {
  const relative = path.relative(root.toLowerCase(), target.toLowerCase());
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
async function safePath(root, relative = '.') {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative))
    throw new Error('Use a path relative to the selected project.');
  const actualRoot = await fs.realpath(root);
  const target = path.resolve(actualRoot, relative);
  if (!inside(actualRoot, target)) throw new Error('Path is outside the selected project.');
  let existing = target;
  while (true) {
    try {
      const real = await fs.realpath(existing);
      if (!inside(actualRoot, real)) throw new Error('Link points outside the selected project.');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error('Cannot resolve project path.');
      existing = parent;
    }
  }
  return target;
}
async function listFiles(root, relative = '.', depth = 2, limit = 300) {
  const start = await safePath(root, relative);
  const output = [];
  async function walk(directory, level) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (output.length >= limit) return;
      if (entry.isSymbolicLink() || OMIT.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (!(await safePath(root, path.relative(root, full)))) continue;
      output.push({ path: path.relative(root, full).replaceAll('\\', '/'), name: entry.name,
        directory: entry.isDirectory(), depth: level });
      if (entry.isDirectory() && level < Math.min(depth, 4) - 1) await walk(full, level + 1);
    }
  }
  await walk(start, 0); return output;
}
async function readFile(root, relative, startLine = 1, endLine = 240) {
  const filename = await safePath(root, relative);
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Open a text file smaller than 2 MiB.');
  const content = await fs.readFile(filename, 'utf8');
  if (content.slice(0, 8192).includes('\0')) throw new Error('This appears to be a binary file.');
  const lines = content.split('\n');
  const start = Math.max(1, Number(startLine) || 1);
  const end = Math.min(lines.length, Number(endLine) || 240, start + 499);
  return { path: relative, content: lines.slice(start - 1, end).join('\n').slice(0, 24000),
    totalLines: lines.length, startLine: start, endLine: end, hash: hash(content),
    truncated: end < lines.length || content.length > 24000 };
}
async function fullFile(root, relative) {
  const filename = await safePath(root, relative);
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('File exceeds the 2 MiB editor limit.');
  const content = await fs.readFile(filename, 'utf8');
  if (content.slice(0, 8192).includes('\0')) throw new Error('Binary files cannot be edited here.');
  return { path: relative, content, hash: hash(content) };
}
async function writeFile(root, relative, content, expectedHash, exclusive = false) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 2 * 1024 * 1024)
    throw new Error('Provide text smaller than 2 MiB.');
  const filename = await safePath(root, relative);
  let before = '', existed = false;
  try { before = (await fullFile(root, relative)).content; existed = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exclusive && existed) throw new Error('This file already exists. Choose another name.');
  if (expectedHash !== undefined && hash(before) !== expectedHash)
    throw new Error('This file changed on disk. Reopen it before saving.');
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await safePath(root, relative);
  await fs.writeFile(filename, content, { encoding: 'utf8', flag: exclusive ? 'wx' : 'w' });
  const segments = diffLines(before, content);
  return { id: crypto.randomUUID(), path: relative, before, after: content, existed,
    beforeHash: hash(before), afterHash: hash(content), createdAt: Date.now(), reverted: false,
    additions: segments.filter(s => s.added).reduce((n, s) => n + s.count, 0),
    deletions: segments.filter(s => s.removed).reduce((n, s) => n + s.count, 0),
    patch: createPatch(relative, before, content) };
}
async function replaceText(root, relative, oldText, newText) {
  if (typeof oldText !== 'string' || !oldText) throw new Error('old_text must be nonempty.');
  const current = await fullFile(root, relative);
  const occurrences = current.content.split(oldText).length - 1;
  if (occurrences !== 1) throw new Error(`Expected one exact match; found ${occurrences}. Read the file and retry.`);
  return writeFile(root, relative, current.content.replace(oldText, newText), current.hash);
}
async function undoChange(root, change) {
  const current = await fullFile(root, change.path);
  if (current.hash !== change.afterHash) throw new Error('The file changed after this edit. Review it in the editor before undoing.');
  const filename = await safePath(root, change.path);
  if (change.existed) await fs.writeFile(filename, change.before, 'utf8');
  else await fs.unlink(filename);
}
async function searchText(root, query, relative = '.') {
  if (typeof query !== 'string' || query.length < 1 || query.length > 300) throw new Error('Provide a short literal search string.');
  const files = await listFiles(root, relative, 4, 1000);
  const matches = [];
  for (const file of files) {
    if (file.directory || matches.length >= 60) continue;
    try {
      const text = await fullFile(root, file.path);
      text.content.split('\n').forEach((line, index) => {
        if (matches.length < 60 && line.toLowerCase().includes(query.toLowerCase()))
          matches.push({ path: file.path, line: index + 1, text: line.slice(0, 260) });
      });
    } catch {}
  }
  return matches;
}
module.exports = { safePath, listFiles, readFile, fullFile, writeFile, replaceText, undoChange, searchText, hash };
