const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Free Apple IDs ("personal teams") cannot sign apps with Sign in with Apple. Expo adds that
 * entitlement automatically whenever expo-apple-authentication is installed, so remove it
 * for PERSONAL_TEAM builds (see app.config.ts).
 */
module.exports = function withPersonalTeam(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['com.apple.developer.applesignin'];
    return mod;
  });
};
