// Mirrors the Android layout for Arabic. React Native's I18nUtil decides RTL from
// Locale.getAvailableLocales()[0] (usually "af", never RTL) rather than the user's language,
// and expo-localization only *allows* RTL, so Arabic screens stayed left-to-right on Android
// while iOS mirrored them. This plugin makes MainApplication set React Native's direction
// flags from the user's locales before React Native starts, and again when they change.
//
// The rule matches src/lib/i18n.ts: the first English or Arabic locale in the user's list is
// the UI language; Arabic is right-to-left, anything else left-to-right. A device set to
// Persian or Hebrew gets the English UI, so it is not mirrored either.
//
// React Native reads the flags once per JavaScript load, so a locale change while the app
// runs takes effect when JavaScript reloads (the app does that on a locale change).
const { withMainApplication } = require('expo/config-plugins');

const MARKER = '[translator] layout direction';

const IMPORTS = ['import android.os.LocaleList', 'import com.facebook.react.modules.i18nmanager.I18nUtil'];

const HELPER = `
  // ${MARKER}: React Native's own check looks at Locale.getAvailableLocales()[0],
  // not the user's language. Same rule as src/lib/i18n.ts: the first English or Arabic
  // locale is the UI language.
  private fun syncLayoutDirection(locales: LocaleList) {
    val ui = (0 until locales.size()).map { locales[it].language }.firstOrNull { it == "ar" || it == "en" }
    val rtl = ui == "ar"
    val i18n = I18nUtil.instance
    i18n.allowRTL(this, true)
    i18n.forceRTL(this, rtl)
    i18n.swapLeftAndRightInRTL(this, true)
  }`;

function addImports(src) {
  const missing = IMPORTS.filter((line) => !src.includes(line));
  if (missing.length === 0) return src;
  const packageLine = /^package .+$/m;
  if (!packageLine.test(src)) throw new Error('with-android-rtl: MainApplication has no package line');
  return src.replace(packageLine, (line) => `${line}\n\n${missing.join('\n')}`);
}

function addCalls(src) {
  const load = /^(\s*)loadReactNative\(this\)/m;
  if (!load.test(src)) throw new Error('with-android-rtl: loadReactNative(this) not found in MainApplication.onCreate; update the plugin');
  src = src.replace(load, (line, indent) => `${indent}syncLayoutDirection(LocaleList.getDefault())\n${line}`);

  const configChanged = /^(\s*)super\.onConfigurationChanged\(newConfig\)/m;
  if (!configChanged.test(src)) throw new Error('with-android-rtl: onConfigurationChanged not found in MainApplication; update the plugin');
  return src.replace(configChanged, (line, indent) => `${line}\n${indent}syncLayoutDirection(newConfig.locales)`);
}

function addHelper(src) {
  const end = src.lastIndexOf('\n}');
  if (end < 0) throw new Error('with-android-rtl: cannot find the end of the MainApplication class');
  return `${src.slice(0, end)}\n${HELPER}${src.slice(end)}`;
}

module.exports = function withAndroidRtl(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') throw new Error('with-android-rtl expects a Kotlin MainApplication');
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    src = addImports(src);
    src = addCalls(src);
    src = addHelper(src);
    cfg.modResults.contents = src;
    return cfg;
  });
};
