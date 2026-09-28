module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo adds the Reanimated/Worklets plugin automatically.
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
