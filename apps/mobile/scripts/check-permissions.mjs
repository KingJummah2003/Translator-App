// Run after `expo prebuild`: fails if the generated native projects lost something the app
// depends on.
// - Permission explanations: iOS terminates an app that requests a protected resource
//   without one, so a plugin silently removing a key (as expo-camera's
//   microphonePermission:false does) is a crash.
// - Android RTL (plugins/with-android-rtl.js): without it Arabic screens are not mirrored.
// - Android theme (plugins/with-android-theme.js): without it native widgets fall back to
//   AppCompat teal and blank frames are black or grey.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const theme = require('../plugins/with-android-theme.js');

const IOS_KEYS = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSSpeechRecognitionUsageDescription',
  'NSFaceIDUsageDescription',
];
const ANDROID_PERMISSIONS = ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'];

let failed = false;
const fail = (message) => {
  console.error(`✗ ${message}`);
  failed = true;
};
const warn = (message) => console.warn(`! ${message}`);
const read = (path) => readFileSync(path, 'utf8');

/* ------------------------------------------------------------------ iOS */

const plist = join(root, 'ios/Translator/Info.plist');
if (existsSync(plist)) {
  const json = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist]).toString());
  for (const key of IOS_KEYS) {
    if (!json[key]) fail(`iOS Info.plist is missing ${key}`);
  }
  // Localized prompts are not required (iOS falls back to English), so only warn.
  const appJson = JSON.parse(read(join(root, 'app.json')));
  for (const lang of Object.keys(appJson.expo?.locales ?? {})) {
    const strings = join(root, `ios/Translator/Supporting/${lang}.lproj/InfoPlist.strings`);
    if (!existsSync(strings)) {
      warn(`iOS has no ${lang}.lproj/InfoPlist.strings (app.json "locales"): permission prompts stay English`);
      continue;
    }
    const text = read(strings);
    const missing = IOS_KEYS.filter((key) => !text.includes(key));
    if (missing.length) warn(`iOS ${lang}.lproj/InfoPlist.strings has no ${missing.join(', ')}`);
  }
}

/* ------------------------------------------------------------------ Android */

const androidMain = join(root, 'android/app/src/main');
const manifest = join(androidMain, 'AndroidManifest.xml');
if (existsSync(manifest)) {
  const xml = read(manifest);
  for (const perm of ANDROID_PERMISSIONS) {
    if (!xml.includes(`"${perm}"`)) fail(`AndroidManifest.xml is missing ${perm}`);
  }
  if (!xml.includes('android:supportsRtl="true"')) fail('AndroidManifest.xml does not set android:supportsRtl="true"');

  checkRtl();
  checkTheme();
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) {
      return path;
    }
  }
  return null;
}

function checkRtl() {
  const app = findFile(join(androidMain, 'java'), 'MainApplication.kt');
  if (!app) return fail('MainApplication.kt not found');
  const src = read(app);
  const sync = src.indexOf('syncLayoutDirection(LocaleList.getDefault())');
  const load = src.indexOf('loadReactNative(this)');
  if (sync < 0 || !src.includes('i18n.forceRTL(this, rtl)')) {
    fail('MainApplication.kt does not sync the layout direction (plugins/with-android-rtl.js)');
  } else if (load >= 0 && sync > load) {
    fail('MainApplication.kt syncs the layout direction after React Native starts');
  }
  if (!src.includes('syncLayoutDirection(newConfig.locales)')) {
    fail('MainApplication.kt does not sync the layout direction on configuration changes');
  }
}

/** name -> value of every <tag name="...">value</tag> in an XML string. */
function xmlValues(xml, tag) {
  const values = {};
  for (const [, name, value] of xml.matchAll(new RegExp(`<${tag} name="([^"]+)"[^>]*>([^<]*)</${tag}>`, 'g'))) {
    values[name] = value.trim();
  }
  return values;
}

function checkTheme() {
  const res = join(androidMain, 'res');
  for (const [folder, expected] of [
    ['values', theme.LIGHT],
    ['values-night', theme.DARK],
  ]) {
    const file = join(res, folder, 'colors.xml');
    const colors = existsSync(file) ? xmlValues(read(file), 'color') : {};
    for (const [name, value] of Object.entries(expected)) {
      if (colors[name]?.toUpperCase() !== value.toUpperCase()) {
        fail(`${folder}/colors.xml: ${name} is ${colors[name] ?? 'missing'}, expected ${value} (plugins/with-android-theme.js)`);
      }
    }
  }
  const stylesFile = join(res, 'values/styles.xml');
  const styles = existsSync(stylesFile) ? read(stylesFile) : '';
  const appTheme = styles.match(/<style name="AppTheme"[^>]*>([\s\S]*?)<\/style>/)?.[1];
  if (!appTheme) return fail('values/styles.xml has no AppTheme');
  const items = xmlValues(appTheme, 'item');
  for (const [name, value] of Object.entries(theme.THEME_ITEMS)) {
    if (items[name] !== value) fail(`AppTheme ${name} is ${items[name] ?? 'missing'}, expected ${value} (plugins/with-android-theme.js)`);
  }
}

if (failed) process.exit(1);
console.log('Native project checks OK (permissions, Android RTL and theme)');
