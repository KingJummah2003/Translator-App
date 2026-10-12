// Screenshots every screen for design review: node e2e/capture.mjs <label>
// Run with the API and Metro running and the app installed on the emulator.
import { back, find, hideKeyboard, launch, openLink, screenshot, sleep, tapXY, type } from './driver.mjs';

const label = process.argv[2] ?? 'light';
const shot = (name) => screenshot(`${label}-${name}`);
const TAB_Y = 2232; // bottom navigation centre on a 1080x2400 screen
const tabs = { translate: 108, camera: 324, talk: 540, files: 756, account: 972 };
const tab = (name) => tapXY(tabs[name], TAB_Y);

launch();
await sleep(9000);

await tab('translate');
await shot('01-translate-empty');
await tapXY(540, 660);
await type('Where is the nearest pharmacy?');
await hideKeyboard();
await sleep(2500);
await shot('02-translate-result');

const pill = find(/^Translate to|^Arabic|^English/);
if (pill) await tapXY(pill.x, pill.y);
await sleep(1500);
await shot('03-languages');
await back();
await sleep(800);

await tab('camera');
await sleep(1500);
await shot('04-camera');
await tab('talk');
await sleep(1000);
await shot('05-talk');
await tab('files');
await sleep(1000);
await shot('06-files');
await tab('account');
await sleep(1500);
await shot('07-account');

openLink('sign-in');
await sleep(2500);
await shot('08-sign-in');
const email = find(/Continue with email|المتابعة بالبريد/);
if (email) {
  await tapXY(email.x, email.y);
  await sleep(800);
  await shot('09-sign-in-email');
}
await back();
await back();
await sleep(800);

openLink('plans');
await sleep(2500);
await shot('10-plans');
await back();
await sleep(800);

openLink('offline');
await sleep(2500);
await shot('11-offline');
await back();

openLink('history');
await sleep(2000);
await shot('12-history');
await back();

openLink('word?word=%D9%85%D8%AD%D8%B7%D8%A9&lang=ar');
await sleep(4000);
await shot('13-word');
await back();
console.log(`Saved screenshots for ${label}`);
