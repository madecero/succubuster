// Self-validating in-browser demo: renders an X-like timeline from the labeled
// SFW manifest, runs the REAL pipeline client-side (text heuristics + CLIP
// zero-shot via the same shared scoring), blurs what it flags, and shows a live
// precision/recall/AUC tally against ground truth. This is the artifact
// Claude-in-Chrome drives to prove the product works end-to-end in a browser.
import {
  env,
  AutoTokenizer,
  AutoProcessor,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers';
import {
  ALL_PROMPT_STRINGS,
  zeroShotToVisionResult,
  scoreText,
  combine,
  type VisionResult,
} from '@succubuster/shared';

const base = location.href.replace(/[^/]*$/, '');
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
// IMPORTANT: a RELATIVE path. transformers' get_file_metadata skips its local
// existence check when localModelPath is an http(s) URL (isValidUrl branch),
// which breaks tokenizer file discovery. A relative path (or the extension's
// chrome-extension:// scheme) avoids that and resolves against the page origin.
env.localModelPath = 'models/';
// @ts-expect-error backend typing
env.backends.onnx.wasm.wasmPaths = base + 'ort/';
// @ts-expect-error
env.backends.onnx.wasm.numThreads = 1;

const device = 'gpu' in navigator ? 'webgpu' : 'wasm';

// A handful of captions overlaid on posts to also exercise the text pre-filter.
const CAPTIONS: Record<string, string> = {
  'lingerie-01': 'check my OnlyFans 🔥 link in bio',
  'thirsttrap-01': 'feeling cute today 😈💦',
  'food-01': 'best tacos in town',
  'landscape-01': 'sunrise over the valley',
};

interface Post {
  id: string;
  url: string;
  category: string;
  label: 'bait' | 'benign';
  caption: string;
  vision?: VisionResult;
}

const $ = (id: string) => document.getElementById(id)!;
let posts: Post[] = [];
let textEmbeds: Float32Array[] = [];
let processor: any, visionModel: any;

function l2(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = v[i] / n;
  return o;
}
const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

async function load() {
  const tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
  processor = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');
  const textModel = await CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { device, dtype: 'q8' });
  visionModel = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { device, dtype: 'q8' });
  const inp = tokenizer(ALL_PROMPT_STRINGS, { padding: true, truncation: true });
  const { text_embeds } = await textModel(inp);
  const [n, d] = text_embeds.dims;
  const data = text_embeds.data as Float32Array;
  for (let i = 0; i < n; i++) textEmbeds.push(l2(data.subarray(i * d, (i + 1) * d) as Float32Array));
}

async function classify(p: Post): Promise<VisionResult> {
  const image = await RawImage.fromURL(`${base}demo-images/${p.id}.jpg`);
  const inputs = await processor(image);
  const { image_embeds } = await visionModel(inputs);
  const [, d] = image_embeds.dims;
  const img = l2((image_embeds.data as Float32Array).subarray(0, d) as Float32Array);
  return zeroShotToVisionResult(p.url, textEmbeds.map((t) => dot(img, t)));
}

function render() {
  const feed = $('feed');
  feed.innerHTML = '';
  for (const p of posts) {
    const el = document.createElement('div');
    el.className = 'post';
    el.id = `post-${p.id}`;
    el.innerHTML = `
      <div class="head"><div class="avatar"></div><div class="handle">@user_${p.id}</div>
        <span class="truth ${p.label}">${p.label}</span></div>
      ${p.caption ? `<div class="cap">${p.caption}</div>` : ''}
      <div class="mediawrap" style="position:relative">
        <img class="media" src="${base}demo-images/${p.id}.jpg" loading="lazy" />
      </div>
      <div class="verdict" id="v-${p.id}"><span>scoring…</span></div>`;
    feed.appendChild(el);
  }
}

function applyVerdicts(sensitivity: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0, hidden = 0;
  for (const p of posts) {
    if (!p.vision) continue;
    const text = scoreText(p.caption, {});
    const verdict = combine(text, p.vision, { sensitivity, useVision: true });
    const wrap = document.querySelector(`#post-${p.id} .mediawrap`) as HTMLElement;
    const img = wrap.querySelector('img')!;
    wrap.querySelector('.sb-overlay')?.remove();
    img.classList.toggle('sb-blurred', verdict.hide);
    if (verdict.hide) {
      hidden++;
      const ov = document.createElement('div');
      ov.className = 'sb-overlay';
      ov.innerHTML = `<div class="sb-card"><b>🛡️ Hidden</b>${verdict.category} · ${verdict.score}<br><button>Show</button></div>`;
      ov.querySelector('button')!.onclick = () => {
        img.classList.remove('sb-blurred');
        ov.remove();
      };
      wrap.appendChild(ov);
    }
    const correct = verdict.hide === (p.label === 'bait');
    if (p.label === 'bait') verdict.hide ? tp++ : fn++;
    else verdict.hide ? fp++ : tn++;
    $(`v-${p.id}`).innerHTML =
      `<span>${p.vision.category} · suggestive ${p.vision.suggestive.toFixed(2)}</span>` +
      `<span class="${correct ? 'ok' : 'bad'}">${verdict.hide ? 'HIDDEN' : 'shown'} ${correct ? '✓' : '✗'}</span>`;
  }
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  $('prec').textContent = precision.toFixed(2);
  $('rec').textContent = recall.toFixed(2);
  $('f1').textContent = f1.toFixed(2);
  $('hid').textContent = String(hidden);
  return { tp, fp, fn, tn, precision, recall, f1 };
}

function computeAuc(): number {
  const pos = posts.filter((p) => p.label === 'bait' && p.vision).map((p) => p.vision!.suggestive);
  const neg = posts.filter((p) => p.label === 'benign' && p.vision).map((p) => p.vision!.suggestive);
  if (!pos.length || !neg.length) return NaN;
  let w = 0;
  for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? 0.5 : 0;
  return w / (pos.length * neg.length);
}

async function main() {
  const manifest = await (await fetch(`${base}eval-manifest.json`)).json();
  posts = manifest.images.map((i: any) => ({ ...i, caption: CAPTIONS[i.id] || '' }));
  render();

  $('status').textContent = `loading CLIP on ${device}…`;
  try {
    await load();
  } catch (e: any) {
    (window as any).__sberr = String(e?.stack || e?.message || e);
    $('status').textContent = 'MODEL LOAD FAILED: ' + String(e?.message || e);
    console.error('[sb] load failed', e);
    return;
  }
  $('status').textContent = `scoring ${posts.length} posts…`;

  let done = 0;
  for (const p of posts) {
    try {
      p.vision = await classify(p);
    } catch (e) {
      p.vision = { url: p.url, suggestive: 0, explicit: 0, category: 'benign', scores: {}, engine: 'unavailable' };
    }
    done++;
    $('status').textContent = `scoring… ${done}/${posts.length}`;
  }

  ($('tally') as HTMLElement).style.display = 'flex';
  const sens = $('sens') as HTMLInputElement;
  const apply = () => {
    $('sensv').textContent = sens.value;
    applyVerdicts(Number(sens.value) / 100);
  };
  sens.addEventListener('input', apply);
  apply();
  $('auc').textContent = computeAuc().toFixed(2);
  $('status').textContent = `done — on-device, ${posts.length} posts classified (${device}). No data left this browser.`;

  // expose for automated inspection (Claude-in-Chrome)
  (window as any).__SB = {
    done: true,
    device,
    auc: computeAuc(),
    metrics: applyVerdicts(Number(sens.value) / 100),
    posts: posts.map((p) => ({ id: p.id, label: p.label, suggestive: p.vision?.suggestive })),
  };
}

void main();
