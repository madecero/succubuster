// Content script: scans the X timeline, extracts each post, runs the free text
// pre-filter, asks the offscreen classifier to score any images, then blurs/hides
// bait — with a "why" overlay, one-click restore, and a feedback button. A small
// log panel (carried over from the userscript) shows every decision.

import {
  scoreText,
  combine,
  DEFAULT_SETTINGS,
  type Settings,
  type Verdict,
  type VisionResult,
  type ExtractedPost,
} from '@succubuster/shared';

let settings: Settings = { ...DEFAULT_SETTINGS };
const processed = new WeakSet<Element>();
const sessionAllow = new Set<string>(); // restored this session
const hiddenLog: Array<{ handle: string; verdict: Verdict; snippet: string; cell: HTMLElement }> = [];
let hiddenCount = 0;
let scannedCount = 0;

const host = location.hostname;

/* ----------------------------- extraction ----------------------------- */

function handleOf(article: Element): string {
  const links = article.querySelectorAll('[data-testid="User-Name"] a[href^="/"]');
  for (const a of links) {
    const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]+)$/);
    if (m) return '@' + m[1];
  }
  return '@unknown';
}

function cellOf(article: Element): HTMLElement {
  return (article.closest('[data-testid="cellInnerDiv"]') as HTMLElement) || (article as HTMLElement);
}

/** Request a small render of a pbs.twimg media URL — cheaper to fetch + classify. */
function smallify(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes('twimg.com')) {
      u.searchParams.set('name', 'small');
      if (!u.searchParams.get('format')) u.searchParams.set('format', 'jpg');
    }
    return u.toString();
  } catch {
    return url;
  }
}

function mediaUrlsOf(article: Element): string[] {
  const imgs = article.querySelectorAll<HTMLImageElement>(
    '[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]',
  );
  const urls = new Set<string>();
  for (const img of imgs) {
    if (img.src && img.src.includes('pbs.twimg.com/media')) urls.add(smallify(img.src));
  }
  return [...urls];
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function extract(article: Element): ExtractedPost {
  const textEl = article.querySelector('[data-testid="tweetText"]');
  const nameEl = article.querySelector('[data-testid="User-Name"]');
  const caption = (textEl?.textContent || '') + ' ' + (nameEl?.textContent || '');
  const handle = handleOf(article);
  const mediaUrls = mediaUrlsOf(article);
  const sensitiveFlag = /sensitive content|potentially sensitive/i.test(article.textContent || '');
  const postKey = handle + '|' + hash(caption + '|' + mediaUrls.join(','));
  return { postKey, handle, caption: caption.trim(), mediaUrls, sensitiveFlag };
}

/* ------------------------------ classify ------------------------------ */

async function classifyImages(urls: string[]): Promise<VisionResult[]> {
  if (!urls.length) return [];
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'classify', urls });
    if (resp && resp.type === 'classifyResult') return resp.results as VisionResult[];
  } catch (e) {
    // service worker asleep / no models yet — degrade to text-only.
    console.debug('[succubuster] classify failed, text-only', e);
  }
  return [];
}

/* -------------------------------- UI ---------------------------------- */

function applyHide(cell: HTMLElement, handle: string, verdict: Verdict, snippet: string) {
  if (settings.mode === 'hide') {
    cell.dataset.sbHidden = '1';
    cell.style.display = 'none';
  } else {
    blurCell(cell, handle, verdict, snippet);
  }
  hiddenCount++;
  hiddenLog.unshift({ handle, verdict, snippet, cell });
  if (hiddenLog.length > 200) hiddenLog.pop();
  renderPanel();
  pushStats();
}

function restore(cell: HTMLElement, handle: string) {
  cell.style.display = '';
  delete cell.dataset.sbHidden;
  cell.querySelector('.sb-overlay')?.remove();
  const content = cell.querySelector<HTMLElement>('.sb-blurred');
  if (content) content.classList.remove('sb-blurred');
  sessionAllow.add(handle); // don't re-hide this account this session
  const i = hiddenLog.findIndex((h) => h.cell === cell);
  if (i > -1) hiddenLog.splice(i, 1);
  hiddenCount = Math.max(0, hiddenCount - 1);
  renderPanel();
}

function blurCell(cell: HTMLElement, handle: string, verdict: Verdict, snippet: string) {
  if (cell.querySelector('.sb-overlay')) return;
  cell.style.position = 'relative';
  const inner = cell.firstElementChild as HTMLElement | null;
  if (inner) inner.classList.add('sb-blurred');

  const overlay = document.createElement('div');
  overlay.className = 'sb-overlay';
  overlay.innerHTML = `
    <div class="sb-card">
      <div class="sb-title">🛡️ Hidden by Succubuster</div>
      <div class="sb-why">${verdict.category} · score ${verdict.score}</div>
      <div class="sb-actions">
        <button class="sb-show">Show anyway</button>
        <button class="sb-notbait">Not bait</button>
      </div>
    </div>`;
  overlay.querySelector('.sb-show')!.addEventListener('click', () => restore(cell, handle));
  overlay.querySelector('.sb-notbait')!.addEventListener('click', () => {
    sendFeedback('false-positive', handle, snippet);
    restore(cell, handle);
  });
  cell.appendChild(overlay);
}

function sendFeedback(label: 'false-positive' | 'missed-bait', handle: string, caption: string) {
  chrome.runtime.sendMessage({ type: 'feedback', postKey: handle, label, caption, mediaUrls: [] }).catch(() => {});
}

function pushStats() {
  chrome.runtime.sendMessage({ type: 'stats', hidden: hiddenCount, scanned: scannedCount }).catch(() => {});
}

/* ------------------------------ panel --------------------------------- */

let panel: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let badge: HTMLElement | null = null;
let panelOpen = false;

function buildPanel() {
  panel = document.createElement('div');
  panel.className = 'sb-panel';
  const btn = document.createElement('button');
  btn.className = 'sb-toggle';
  badge = document.createElement('span');
  badge.textContent = '0';
  btn.append('🛡️ hidden: ', badge);
  const box = document.createElement('div');
  box.className = 'sb-box';
  const title = document.createElement('div');
  title.className = 'sb-box-title';
  title.textContent = 'Removed posts (click a handle to restore)';
  listEl = document.createElement('div');
  box.append(title, listEl);
  btn.addEventListener('click', () => {
    panelOpen = !panelOpen;
    box.style.display = panelOpen ? 'block' : 'none';
  });
  panel.append(btn, box);
  document.body.appendChild(panel);
}

function renderPanel() {
  if (!panel) buildPanel();
  badge!.textContent = String(hiddenCount);
  listEl!.innerHTML = '';
  for (const h of hiddenLog) {
    const row = document.createElement('div');
    row.className = 'sb-row';
    const a = document.createElement('a');
    a.textContent = h.handle;
    a.href = '#';
    a.className = 'sb-handle';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      restore(h.cell, h.handle);
    });
    const why = document.createElement('div');
    why.className = 'sb-dim';
    why.textContent = `${h.verdict.category} · score ${h.verdict.score} · ${h.verdict.reasons.join(' | ')}`;
    const snip = document.createElement('div');
    snip.className = 'sb-snip';
    snip.textContent = h.snippet || '(image-only)';
    row.append(a, why, snip);
    listEl!.appendChild(row);
  }
}

/* ------------------------------ process ------------------------------- */

async function process(article: Element) {
  if (processed.has(article)) return;
  processed.add(article);
  scannedCount++;

  const post = extract(article);
  if (sessionAllow.has(post.handle) || settings.allowlist.includes(post.handle)) return;

  const text = scoreText(post.caption, { sensitiveFlag: post.sensitiveFlag });

  // Free text hard rule first — no vision cost.
  let verdict = combine(text, null, settings);
  if (verdict.hide) {
    applyHide(cellOf(article), post.handle, verdict, post.caption.slice(0, 140));
    return;
  }

  // Otherwise, if there are images and vision is on, score them.
  if (settings.useVision && post.mediaUrls.length) {
    const results = await classifyImages(post.mediaUrls);
    // worst (most suggestive) image drives the post decision
    const worst = results.sort((a, b) => Math.max(b.suggestive, b.explicit) - Math.max(a.suggestive, a.explicit))[0];
    verdict = combine(text, worst ?? null, settings);
    if (verdict.hide) applyHide(cellOf(article), post.handle, verdict, post.caption.slice(0, 140));
  }
  pushStats();
}

function scan() {
  if (!settings.enabled || settings.perSite[host] === false || !settings.consented) return;
  document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => void process(a));
}

/* ------- throttled scan (ported: avoids the debounce-starvation bug) ------- */

let lastScan = 0;
let pending = false;
function throttledScan() {
  const now = Date.now();
  if (now - lastScan >= 400) {
    lastScan = now;
    scan();
    return;
  }
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    lastScan = Date.now();
    scan();
  }, 400);
}

/* ------------------------------- boot --------------------------------- */

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .sb-blurred { filter: blur(22px); pointer-events: none; user-select: none; }
    .sb-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 5; }
    .sb-card { background: rgba(21,32,43,.92); border: 1px solid #38444d; border-radius: 12px; padding: 14px 18px; text-align: center; color: #e7e9ea; font: 13px/1.4 system-ui, sans-serif; }
    .sb-title { font-weight: 700; margin-bottom: 4px; }
    .sb-why { color: #8899a6; margin-bottom: 10px; text-transform: capitalize; }
    .sb-actions { display: flex; gap: 8px; justify-content: center; }
    .sb-actions button { border: 0; border-radius: 999px; padding: 6px 12px; cursor: pointer; font-weight: 600; }
    .sb-show { background: #1d9bf0; color: #fff; }
    .sb-notbait { background: transparent; color: #e7e9ea; border: 1px solid #38444d !important; }
    .sb-panel { position: fixed; bottom: 16px; right: 16px; z-index: 99999; font: 12px/1.4 system-ui, sans-serif; }
    .sb-toggle { background: #15202b; color: #fff; border: 1px solid #38444d; border-radius: 20px; padding: 8px 14px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
    .sb-box { display: none; margin-top: 8px; width: 340px; max-height: 50vh; overflow: auto; background: #15202b; color: #fff; border: 1px solid #38444d; border-radius: 10px; padding: 10px; }
    .sb-box-title { font-weight: 600; margin-bottom: 8px; color: #8899a6; }
    .sb-row { padding: 6px 0; border-top: 1px solid #243340; }
    .sb-handle { color: #1d9bf0; text-decoration: none; font-weight: 600; }
    .sb-dim { color: #8899a6; margin-top: 2px; }
    .sb-snip { color: #aab8c2; margin-top: 2px; font-style: italic; }
  `;
  document.documentElement.appendChild(style);
}

async function boot() {
  injectStyles();
  const stored = (await chrome.storage.local.get('settings')) as { settings?: Partial<Settings> };
  if (stored.settings) settings = { ...DEFAULT_SETTINGS, ...stored.settings };

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Partial<Settings>) };
      scan();
    }
  });

  const obs = new MutationObserver(throttledScan);
  obs.observe(document.body, { childList: true, subtree: true });

  scan();
  setInterval(scan, 1500);
  [300, 800, 1500, 3000].forEach((d) => setTimeout(scan, d));
}

void boot();
