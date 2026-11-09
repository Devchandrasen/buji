import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
await fs.mkdir('dist', { recursive: true });
await import('./tools/license-notices.mjs');
await esbuild.build({ entryPoints: ['src/renderer.jsx'], bundle: true, outfile: 'dist/renderer.js',
  platform: 'browser', format: 'iife', target: 'chrome145', minify: true, sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' } });
await esbuild.build({ entryPoints: ['src/main.cjs'], bundle: true, outfile: 'dist/main.cjs',
  platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], sourcemap: true });
await fs.copyFile('src/preload.cjs', 'dist/preload.cjs');
await fs.copyFile('src/index.html', 'dist/index.html');
await fs.copyFile('src/styles.css', 'dist/styles.css');
await fs.copyFile('src/conversation-desk.css', 'dist/conversation-desk.css');
await fs.copyFile('src/security.css', 'dist/security.css');
await fs.copyFile('assets/buji.png', 'dist/buji.png');
await fs.copyFile('tools/computer-worker.ps1', 'dist/computer-worker.ps1');
await fs.copyFile('tools/visual-capture.py', 'dist/visual-capture.py');
console.log('Buji desktop built.');
