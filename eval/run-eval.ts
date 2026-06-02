// Accuracy proof: run the bundled CLIP zero-shot over the labeled manifest, then
// report separation (AUC), a threshold sweep (precision/recall/F1), the operating
// point, and the per-category false-positive breakdown (the trust metric).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadClip, embedUrl, classifyVector } from './clip-node.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Item {
  id: string;
  url: string;
  category: string;
  label: 'bait' | 'benign';
}
interface Scored extends Item {
  suggestive: number;
  explicit: number;
  top: string;
  error?: string;
}

function auc(scores: Scored[]): number {
  const pos = scores.filter((s) => s.label === 'bait').map((s) => s.suggestive);
  const neg = scores.filter((s) => s.label === 'benign').map((s) => s.suggestive);
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

function metricsAt(scores: Scored[], thr: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const s of scores) {
    const pred = s.suggestive >= thr;
    if (s.label === 'bait') pred ? tp++ : fn++;
    else pred ? fp++ : tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { thr, tp, fp, fn, tn, precision, recall, f1 };
}

function bar(v: number, width = 24) {
  const n = Math.round(v * width);
  return '█'.repeat(n) + '·'.repeat(width - n);
}

async function main() {
  const manifestPath = path.join(here, 'data', 'manifest.json');
  let manifest: { images: Item[] };
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    console.error(`No manifest at ${manifestPath}. See eval/README.`);
    process.exit(1);
    return;
  }

  console.log(`Loading CLIP… (${manifest.images.length} images)`);
  await loadClip();

  const scored: Scored[] = [];
  let i = 0;
  for (const item of manifest.images) {
    i++;
    try {
      const vec = await embedUrl(item.url);
      const r = classifyVector(item.url, vec);
      scored.push({ ...item, suggestive: r.suggestive, explicit: r.explicit, top: r.category });
      process.stdout.write(`\r  scored ${i}/${manifest.images.length}`);
    } catch (e: any) {
      scored.push({ ...item, suggestive: NaN, explicit: NaN, top: 'error', error: String(e?.message || e) });
    }
  }
  console.log('');

  const ok = scored.filter((s) => !Number.isNaN(s.suggestive));
  const errored = scored.filter((s) => Number.isNaN(s.suggestive));
  if (errored.length) console.log(`  (${errored.length} failed to load: ${errored.map((e) => e.id).join(', ')})`);

  // Separation
  const baitMean = avg(ok.filter((s) => s.label === 'bait').map((s) => s.suggestive));
  const benignMean = avg(ok.filter((s) => s.label === 'benign').map((s) => s.suggestive));
  const AUC = auc(ok);

  console.log('\n=== Separation ===');
  console.log(`  mean suggestive — bait:   ${baitMean.toFixed(3)}  ${bar(baitMean)}`);
  console.log(`  mean suggestive — benign: ${benignMean.toFixed(3)}  ${bar(benignMean)}`);
  console.log(`  AUC (rank separation):    ${AUC.toFixed(3)}   (0.5 = chance, 1.0 = perfect)`);

  // Threshold sweep
  console.log('\n=== Threshold sweep (vision suggestive) ===');
  console.log('  thr    P      R      F1     tp fp fn tn');
  const sweep = [];
  for (let t = 0.3; t <= 0.901; t += 0.05) sweep.push(metricsAt(ok, +t.toFixed(2)));
  for (const m of sweep) {
    console.log(
      `  ${m.thr.toFixed(2)}   ${m.precision.toFixed(2)}   ${m.recall.toFixed(2)}   ${m.f1.toFixed(2)}   ${m.tp}  ${m.fp}  ${m.fn}  ${m.tn}`,
    );
  }
  const best = sweep.reduce((a, b) => (b.f1 > a.f1 ? b : a));
  console.log(`\n  best F1 = ${best.f1.toFixed(2)} at threshold ${best.thr.toFixed(2)} (P=${best.precision.toFixed(2)} R=${best.recall.toFixed(2)})`);

  // Per-category false-positive breakdown at best threshold (the trust metric)
  console.log(`\n=== Benign false-positives at thr=${best.thr.toFixed(2)} (lower is better) ===`);
  const benignCats = new Map<string, { fp: number; n: number }>();
  for (const s of ok.filter((x) => x.label === 'benign')) {
    const c = benignCats.get(s.category) ?? { fp: 0, n: 0 };
    c.n++;
    if (s.suggestive >= best.thr) c.fp++;
    benignCats.set(s.category, c);
  }
  for (const [cat, c] of [...benignCats].sort((a, b) => b[1].fp / b[1].n - a[1].fp / a[1].n)) {
    console.log(`  ${cat.padEnd(18)} ${c.fp}/${c.n}  ${bar(c.fp / c.n, 12)}`);
  }

  // Worst offenders
  console.log('\n=== Highest-scored benign (would be wrongly hidden) ===');
  for (const s of ok.filter((x) => x.label === 'benign').sort((a, b) => b.suggestive - a.suggestive).slice(0, 6)) {
    console.log(`  ${s.suggestive.toFixed(2)}  ${s.category.padEnd(16)} ${s.id} (top=${s.top})`);
  }
  console.log('\n=== Lowest-scored bait (would be missed) ===');
  for (const s of ok.filter((x) => x.label === 'bait').sort((a, b) => a.suggestive - b.suggestive).slice(0, 6)) {
    console.log(`  ${s.suggestive.toFixed(2)}  ${s.category.padEnd(16)} ${s.id} (top=${s.top})`);
  }

  await mkdir(path.join(here, 'out'), { recursive: true });
  await writeFile(
    path.join(here, 'out', 'results.json'),
    JSON.stringify({ baitMean, benignMean, AUC, best, scored }, null, 2),
  );
  console.log('\nWrote eval/out/results.json');
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

void main();
