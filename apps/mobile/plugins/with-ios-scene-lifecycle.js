// iOS 27 refuses to launch apps that don't use the UIScene life cycle ("UIScene life cycle
// is required for apps built with this SDK"). Expo SDK 57 ships ExpoAppSceneDelegate for
// this, but the SDK 57 project template doesn't use it yet. This plugin:
//   1. registers EXExpoAppSceneDelegate as the app's scene delegate in Info.plist, and
//   2. makes AppDelegate an ExpoReactNativeFactoryProvider that creates the React Native
//      factory without starting it; the scene delegate starts it in the scene's window.
// Remove this plugin once the Expo template adopts scenes on its own.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return cfg;
  });
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') throw new Error('with-ios-scene-lifecycle expects a Swift AppDelegate');
    let src = cfg.modResults.contents;
    if (src.includes('ExpoReactNativeFactoryProvider')) return cfg;

    src = src.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');

    // The scene delegate creates the window and starts React Native.
    const start = /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;
    if (!start.test(src)) throw new Error('with-ios-scene-lifecycle: AppDelegate template changed; update the plugin');
    src = src.replace(start, '    // React Native is started by ExpoAppSceneDelegate (UIScene life cycle).\n');

    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withIosSceneLifecycle(config) {
  return withSceneAppDelegate(withSceneManifest(config));
};
