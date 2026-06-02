// Download the manifest images locally so the in-browser demo can classify them
// same-origin (no CORS). Writes to extension/demo-images/<id>.jpg; the build
// copies that into dist/demo-images/.
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(root);
const DEST = path.join(root, 'demo-images');

const manifest = JSON.parse(await readFile(path.join(repo, 'eval', 'data', 'manifest.json'), 'utf8'));
await mkdir(DEST, { recursive: true });

let ok = 0;
for (const img of manifest.images) {
  const dest = path.join(DEST, `${img.id}.jpg`);
  if (existsSync(dest) && (await stat(dest)).size > 0) {
    ok++;
    continue;
  }
  try {
    const res = await fetch(img.url);
    if (!res.ok) throw new Error(`${res.status}`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    ok++;
    process.stdout.write(`\r  fetched ${ok}/${manifest.images.length}`);
  } catch (e) {
    console.log(`\n  skip ${img.id}: ${e.message}`);
  }
}
console.log(`\nDone: ${ok}/${manifest.images.length} images in demo-images/`);
