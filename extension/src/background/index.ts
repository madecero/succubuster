// Service worker: owns the offscreen document (the inference host), routes
// classify requests content -> offscreen -> content, and persists feedback +
// stats locally (the privacy-safe seed of the data flywheel — nothing leaves the
// device).

let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) return creating;
  creating = chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run the on-device CLIP image classifier (WebGPU/WASM).',
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(fallback);
    });
  });
}

async function classify(urls: string[]) {
  await ensureOffscreen();
  const results = await withTimeout(
    chrome.runtime.sendMessage({ type: 'sb-classify', urls }),
    20000,
    { results: [] },
  );
  return (results && results.results) || [];
}

async function recordFeedback(msg: { postKey: string; label: string; caption: string; mediaUrls: string[] }) {
  const { feedback = [] } = (await chrome.storage.local.get('feedback')) as { feedback?: any[] };
  feedback.unshift({ ...msg, ts: Date.now() });
  await chrome.storage.local.set({ feedback: feedback.slice(0, 500) });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg?.type) {
    case 'classify':
      classify(msg.urls).then((results) => sendResponse({ type: 'classifyResult', results }));
      return true; // async
    case 'feedback':
      recordFeedback(msg).then(() => sendResponse({ ok: true }));
      return true;
    case 'stats':
      chrome.storage.session
        .set({ stats: { hidden: msg.hidden, scanned: msg.scanned } })
        .then(() => sendResponse({ ok: true }));
      return true;
    default:
      return false;
  }
});

// Open the options page when the toolbar icon is clicked.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
