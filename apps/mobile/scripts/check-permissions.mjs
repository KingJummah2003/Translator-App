// Fails if a permission explanation the app needs is missing from the generated native
// projects. iOS terminates an app that requests a protected resource without one, so a
// plugin silently removing a key (as expo-camera's microphonePermission:false does) is a crash.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const IOS_KEYS = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSSpeechRecognitionUsageDescription',
  'NSFaceIDUsageDescription',
];
const ANDROID_PERMISSIONS = ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'];

let failed = false;
const plist = 'ios/Translator/Info.plist';
if (existsSync(plist)) {
  const json = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist]).toString());
  for (const key of IOS_KEYS) {
    if (!json[key]) {
      console.error(`iOS Info.plist is missing ${key}`);
      failed = true;
    }
  }
}
const manifest = 'android/app/src/main/AndroidManifest.xml';
if (existsSync(manifest)) {
  const xml = readFileSync(manifest, 'utf8');
  for (const perm of ANDROID_PERMISSIONS) {
    if (!xml.includes(`"${perm}"`)) {
      console.error(`AndroidManifest.xml is missing ${perm}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log('Permission declarations OK');
