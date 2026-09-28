const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const componentsRoot = path.resolve(projectRoot, "../components");

const config = getDefaultConfig(projectRoot);

// The demo imports the kit straight from ../components, exactly as a user would after
// copy-pasting it. Watch that folder, and resolve its imports (react-native, reanimated,
// expo-clipboard, …) from this app's node_modules so there is only one copy of each.
config.watchFolders = [componentsRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

module.exports = withNativeWind(config, { input: "./global.css" });
