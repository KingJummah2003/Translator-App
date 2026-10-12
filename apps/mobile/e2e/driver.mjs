// Minimal Android UI driver for end-to-end checks, built on adb + uiautomator.
// It finds elements by visible text or accessibility label, so tests read like steps:
//   await tap('Account'); await waitFor('Sign in to Translator');
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ADB = process.env.ADB ?? join(homedir(), 'Library/Android/sdk/platform-tools/adb');
export const PACKAGE = 'com.translator.app';
export const OUT = process.env.E2E_OUT ?? join(process.cwd(), 'e2e', 'out');

export function adb(...args) {
  return execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** True when a file exists in the app's private storage (debug builds only). */
export function appFileExists(path) {
  try {
    return adb('shell', `run-as ${PACKAGE} ls ${path} 2>/dev/null`).includes(path.split('/').pop());
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Current screen as a flat list of nodes with text, label and centre point. */
export function nodes() {
  let xml = '';
  for (let i = 0; i < 3 && !xml.includes('<hierarchy'); i++) {
    xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
  }
  const out = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const attr = (name) => m[1].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
    const b = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    out.push({
      text: decode(attr('text')),
      label: decode(attr('content-desc')),
      id: attr('resource-id'),
      clickable: attr('clickable') === 'true',
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      w: x2 - x1,
      h: y2 - y1,
    });
  }
  return out;
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#10;/g, '\n');
}

const matches = (n, query) =>
  typeof query === 'string'
    ? n.text === query || n.label === query || n.label.startsWith(`${query},`) || n.label.startsWith(`${query}:`)
    : query.test(n.text) || query.test(n.label);

export function find(query) {
  return nodes().find((n) => matches(n, query) && n.w > 0 && n.h > 0) ?? null;
}

export async function waitFor(query, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const n = find(query);
    if (n) return n;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${query}`);
}

export async function waitGone(query, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!find(query)) return;
    await sleep(400);
  }
  throw new Error(`Still visible: ${query}`);
}

export async function tap(query, timeoutMs) {
  const n = await waitFor(query, timeoutMs);
  adb('shell', 'input', 'tap', String(n.x), String(n.y));
  await sleep(500);
  return n;
}

export async function tapXY(x, y) {
  adb('shell', 'input', 'tap', String(x), String(y));
  await sleep(500);
}

/** Types ASCII text into the focused field (adb can't type non-ASCII; use paste for that). */
export async function type(text) {
  adb('shell', 'input', 'text', text.replace(/ /g, '%s').replace(/([()'"&;<>|*?$`\\])/g, '\\$1'));
  await sleep(400);
}

export async function key(code) {
  adb('shell', 'input', 'keyevent', String(code));
  await sleep(300);
}

export const back = () => key(4);
export const hideKeyboard = () => key(111);

export async function screenshot(name) {
  mkdirSync(OUT, { recursive: true });
  const png = execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, png);
  return file;
}

export function launch({ clear = false } = {}) {
  if (clear) adb('shell', 'pm', 'clear', PACKAGE);
  adb('shell', 'am', 'force-stop', PACKAGE);
  adb('reverse', 'tcp:8081', 'tcp:8081');
  adb('reverse', 'tcp:8790', 'tcp:8790');
  adb('shell', 'am', 'start', '-n', `${PACKAGE}/.MainActivity`);
}

export function openLink(path) {
  // One quoted string: the device shell would otherwise split the URL at '&'.
  adb('shell', `am start -a android.intent.action.VIEW -d 'translator://${path}' ${PACKAGE}`);
}

export function setDarkMode(on) {
  adb('shell', 'cmd', 'uimode', 'night', on ? 'yes' : 'no');
}

export function setAppLocale(locale) {
  adb('shell', 'cmd', 'locale', 'set-app-locales', PACKAGE, '--locales', locale);
}

/** Reads a file from the app's private storage (debug builds only). */
export function readAppFile(path) {
  return execFileSync(ADB, ['exec-out', 'run-as', PACKAGE, 'cat', path], { maxBuffer: 256 * 1024 * 1024 });
}

/** Writes a file into the app's private storage (debug builds only). */
export function writeAppFile(path, data) {
  execFileSync(ADB, ['shell', `run-as ${PACKAGE} sh -c 'cat > ${path}'`], { input: data, maxBuffer: 256 * 1024 * 1024 });
}

export { sleep };
