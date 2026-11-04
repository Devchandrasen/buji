import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const [source, destination] of [['docs/assets/banner.svg', 'docs/assets/social-preview.png'], ['docs/assets/architecture.svg', 'docs/assets/architecture.png']]) {
  const svg = await fs.readFile(path.join(root, source), 'utf8');
  const renderer = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' }, fitTo: { mode: 'width', value: 1280 } });
  await fs.writeFile(path.join(root, destination), renderer.render().asPng());
}
console.log('Rendered editable SVG visuals to PNG.');
