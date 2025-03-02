const { getDefaultConfig } = require("@expo/metro-config");

const config = getDefaultConfig(__dirname);

// Add support for `.cjs` modules
config.resolver.sourceExts = [...config.resolver.sourceExts, "cjs", "jsx", "ts", "tsx"];

// Ensure Metro watches correct directories
config.watchFolders = [__dirname];

module.exports = config;
