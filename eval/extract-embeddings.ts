// Dump normalized CLIP image embeddings + labels for the manifest, so the Python
// trainer can fit the head on the exact same features the browser will produce.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadClip, embedUrl } from './clip-node.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Item { id: string; url: string; category: string; label: 'bait' | 'benign'; }

async function main() {
  const manifest: { images: Item[] } = JSON.parse(
    await readFile(path.join(here, 'data', 'manifest.json'), 'utf8'),
  );
  await loadClip();
  const rows: Array<{ id: string; label: number; category: string; embedding: number[] }> = [];
  let i = 0;
  for (const item of manifest.images) {
    i++;
    try {
      const v = await embedUrl(item.url);
      rows.push({ id: item.id, label: item.label === 'bait' ? 1 : 0, category: item.category, embedding: Array.from(v) });
      process.stdout.write(`\r  embedded ${i}/${manifest.images.length}`);
    } catch (e: any) {
      console.log(`\n  skip ${item.id}: ${e?.message || e}`);
    }
  }
  console.log('');
  await mkdir(path.join(here, 'out'), { recursive: true });
  await writeFile(path.join(here, 'out', 'embeddings.json'), JSON.stringify(rows));
  console.log(`Wrote eval/out/embeddings.json (${rows.length} rows, dim ${rows[0]?.embedding.length})`);
}

void main();
