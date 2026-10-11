// Tells Google Play services which unbundled ML Kit models to download when the app is
// installed. expo-camera also declares this key (for its barcode scanner), so the app
// manifest declares the combined list and overrides both library values.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const KEY = 'com.google.mlkit.vision.DEPENDENCIES';
const MODELS = 'barcode_ui,ocr,ocr_chinese,ocr_devanagari,ocr_japanese,ocr_korean,langid';

module.exports = function withMlkitAndroid(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] ??= 'http://schemas.android.com/tools';
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app['meta-data'] = (app['meta-data'] ?? []).filter((m) => m.$['android:name'] !== KEY);
    app['meta-data'].push({ $: { 'android:name': KEY, 'android:value': MODELS, 'tools:replace': 'android:value' } });
    return cfg;
  });
};
