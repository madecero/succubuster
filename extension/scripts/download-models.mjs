// Downloads the CLIP model assets into extension/models/ in the directory layout
// transformers.js expects when env.allowRemoteModels=false. Run once: everything
// is then bundled locally so the extension fetches NO remote code (MV3/Web-Store
// compliant) and works offline.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const DEST = path.join(root, 'models', MODEL_ID);

// Quantized (uint8) split models: ~85MB vision + ~61MB text. Loaded with dtype 'q8'.
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'preprocessor_config.json',
  'vocab.json',
  'merges.txt',
  'special_tokens_map.json',
  'onnx/vision_model_quantized.onnx',
  'onnx/text_model_quantized.onnx',
];

async function download(rel) {
  const dest = path.join(DEST, rel);
  if (existsSync(dest) && (await stat(dest)).size > 0) {
    console.log(`  skip  ${rel} (exists)`);
    return;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const url = `${BASE}/${rel}`;
  process.stdout.write(`  get   ${rel} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}

console.log(`Downloading ${MODEL_ID} -> ${path.relative(process.cwd(), DEST)}`);
for (const f of FILES) await download(f);
console.log('Done.');
