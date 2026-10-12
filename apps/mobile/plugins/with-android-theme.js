// Gives native Android widgets the app's colours instead of AppCompat's teal defaults:
// switch thumbs, the text cursor, selection handles and highlight, plus the window
// background that shows before React Native draws its first frame (and behind every screen
// transition). Values match src/theme (accent, bg) in light and dark; values-night holds
// the dark ones, and AppTheme's DayNight parent picks between them.
const { AndroidConfig, withAndroidColors, withAndroidColorsNight, withAndroidStyles } = require('expo/config-plugins');

const LIGHT = {
  colorPrimary: '#3346D3',
  colorAccent: '#3346D3',
  // Selection highlight: the accent at 30% opacity, so selected text stays readable.
  textSelectionHighlight: '#4D3346D3',
  appWindowBackground: '#F7F6F3',
};

const DARK = {
  colorPrimary: '#8C9BFF',
  colorAccent: '#8C9BFF',
  textSelectionHighlight: '#668C9BFF',
  appWindowBackground: '#0F1012',
};

const THEME_ITEMS = {
  colorPrimary: '@color/colorPrimary',
  colorAccent: '@color/colorAccent',
  // Switches, checkboxes, the text cursor and selection handles.
  colorControlActivated: '@color/colorAccent',
  'android:textColorHighlight': '@color/textSelectionHighlight',
  'android:windowBackground': '@color/appWindowBackground',
};

function setColors(xml, colors) {
  for (const [name, value] of Object.entries(colors)) {
    xml = AndroidConfig.Colors.assignColorValue(xml, { name, value });
  }
  return xml;
}

module.exports = function withAndroidTheme(config) {
  config = withAndroidColors(config, (cfg) => {
    cfg.modResults = setColors(cfg.modResults, LIGHT);
    return cfg;
  });
  config = withAndroidColorsNight(config, (cfg) => {
    cfg.modResults = setColors(cfg.modResults, DARK);
    return cfg;
  });
  return withAndroidStyles(config, (cfg) => {
    for (const [name, value] of Object.entries(THEME_ITEMS)) {
      cfg.modResults = AndroidConfig.Styles.assignStylesValue(cfg.modResults, {
        add: true,
        parent: AndroidConfig.Styles.getAppThemeGroup(),
        name,
        value,
      });
    }
    return cfg;
  });
};

// Exported for scripts/check-permissions.mjs, which verifies a prebuild applied them.
module.exports.LIGHT = LIGHT;
module.exports.DARK = DARK;
module.exports.THEME_ITEMS = THEME_ITEMS;
