// Options page: sensitivity, mode, toggles, consent, session stats, allowlist.
import { DEFAULT_SETTINGS, type Settings } from '@succubuster/shared';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let settings: Settings = { ...DEFAULT_SETTINGS };

async function save() {
  await chrome.storage.local.set({ settings });
}

function render() {
  ($('consent') as HTMLElement).classList.toggle('show', !settings.consented);
  ($('enabled') as HTMLInputElement).checked = settings.enabled;
  ($('useVision') as HTMLInputElement).checked = settings.useVision;
  ($('sensitivity') as HTMLInputElement).value = String(Math.round(settings.sensitivity * 100));
  $('sensVal').textContent = String(Math.round(settings.sensitivity * 100));
  ($('mode') as HTMLSelectElement).value = settings.mode;
  const allow = settings.allowlist;
  $('allowlist').textContent = allow.length ? allow.join('\n') : '(none)';
}

async function refreshStats() {
  const { stats } = (await chrome.storage.session.get('stats')) as {
    stats?: { hidden: number; scanned: number };
  };
  $('statHidden').textContent = String(stats?.hidden ?? 0);
  $('statScanned').textContent = String(stats?.scanned ?? 0);
}

function bind() {
  $('consentBtn').addEventListener('click', () => {
    settings.consented = true;
    settings.enabled = true;
    save().then(render);
  });
  ($('enabled') as HTMLInputElement).addEventListener('change', (e) => {
    settings.enabled = (e.target as HTMLInputElement).checked;
    save();
  });
  ($('useVision') as HTMLInputElement).addEventListener('change', (e) => {
    settings.useVision = (e.target as HTMLInputElement).checked;
    save();
  });
  ($('sensitivity') as HTMLInputElement).addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    settings.sensitivity = v / 100;
    $('sensVal').textContent = String(v);
    save();
  });
  ($('mode') as HTMLSelectElement).addEventListener('change', (e) => {
    settings.mode = (e.target as HTMLSelectElement).value as Settings['mode'];
    save();
  });
  $('clearAllow').addEventListener('click', () => {
    settings.allowlist = [];
    save().then(render);
  });
}

async function init() {
  const stored = (await chrome.storage.local.get('settings')) as { settings?: Partial<Settings> };
  if (stored.settings) settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  bind();
  render();
  refreshStats();
  setInterval(refreshStats, 2000);
}

void init();
