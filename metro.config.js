const { getDefaultConfig } = require("@expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Ensure Metro watches the correct directories
config.watchFolders = [path.resolve(__dirname, "src")];

// Fix for Expo Router & other `.cjs` modules
config.resolver.sourceExts.push("cjs");

module.exports = config;
