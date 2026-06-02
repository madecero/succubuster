// esbuild build for the Succubuster MV3 extension. Bundles four entry points and
// copies the local model + onnxruntime-web wasm assets into dist/. No Vite/@crxjs
// — fewest moving parts, robust on Node 26.
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const doZip = process.argv.includes('--zip');

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: true,
  // transformers.js pulls node-only optional deps; keep them out of the browser bundle.
  external: ['onnxruntime-node', 'sharp', 'fs', 'path', 'url', 'module', 'crypto', 'worker_threads'],
  define: { 'process.env.NODE_ENV': '"production"' },
  conditions: ['browser', 'import', 'default'],
};

/** classic IIFE for content/options (cannot be ES modules in a content script). */
const iife = (entry, out) => ({ ...shared, entryPoints: [entry], outfile: out, format: 'iife' });
/** ES module for the service worker + offscreen page. */
const esm = (entry, out) => ({ ...shared, entryPoints: [entry], outfile: out, format: 'esm' });

const builds = [
  iife('src/content/index.ts', `${dist}/content.js`),
  esm('src/background/index.ts', `${dist}/background.js`),
  esm('src/offscreen/index.ts', `${dist}/offscreen.js`),
  iife('src/options/index.ts', `${dist}/options.js`),
  esm('src/demo/index.ts', `${dist}/demo.js`),
];

async function copyStatic() {
  await cp(path.join(root, 'manifest.json'), path.join(dist, 'manifest.json'));
  for (const f of ['offscreen.html', 'options.html', 'demo.html']) {
    await cp(path.join(root, 'public', f), path.join(dist, f));
  }

  // Demo assets: the labeled manifest + locally-cached images (served same-origin).
  const manifestSrc = path.join(root, '..', 'eval', 'data', 'manifest.json');
  if (existsSync(manifestSrc)) await cp(manifestSrc, path.join(dist, 'eval-manifest.json'));
  const demoImgs = path.join(root, 'demo-images');
  if (existsSync(demoImgs)) await cp(demoImgs, path.join(dist, 'demo-images'), { recursive: true });

  // onnxruntime-web wasm/mjs runtime, referenced at runtime via wasmPaths.
  // (Its package.json "exports" hides ./package.json, so locate dist by path.)
  const ortCandidates = [
    path.join(root, 'node_modules/onnxruntime-web/dist'),
    path.join(root, '..', 'node_modules/onnxruntime-web/dist'),
  ];
  const ortDist = ortCandidates.find((c) => existsSync(c));
  if (!ortDist) throw new Error('onnxruntime-web/dist not found in node_modules');
  const ortOut = path.join(dist, 'ort');
  await mkdir(ortOut, { recursive: true });
  for (const f of await readdir(ortDist)) {
    if (f.endsWith('.wasm') || f.endsWith('.mjs')) {
      await cp(path.join(ortDist, f), path.join(ortOut, f));
    }
  }

  // Locally-bundled CLIP model (downloaded by scripts/download-models.mjs).
  const models = path.join(root, 'models');
  if (existsSync(models)) {
    await cp(models, path.join(dist, 'models'), { recursive: true });
  } else {
    console.warn('\n[build] WARNING: extension/models is missing. Run `npm run download-models`.');
    console.warn('[build] The extension will load with text-only filtering until models are present.\n');
  }
}

async function zipIt() {
  const out = path.join(root, 'succubuster.zip');
  if (existsSync(out)) await rm(out);
  await exec('zip', ['-r', '-q', out, '.'], { cwd: dist });
  const s = await stat(out);
  console.log(`[build] packaged ${out} (${(s.size / 1e6).toFixed(1)} MB)`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

if (watch) {
  const ctxs = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(ctxs.map((c) => c.watch()));
  await copyStatic();
  console.log('[build] watching…');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  await copyStatic();
  if (doZip) await zipIt();
  console.log('[build] done -> dist/');
}
