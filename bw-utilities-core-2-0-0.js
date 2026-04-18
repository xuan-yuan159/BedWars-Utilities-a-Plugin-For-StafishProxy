const path = require("node:path");
// Patcher need to be first, unless it wont work; lets bypass starfish :fire:
require("./bw-utilities-src/core/patcher");

const BedWarsUtilities = require("./bw-utilities-src/BedWarsUtilities");
const createConfigSchema = require("./bw-utilities-src/config/configSchema");
const { Localizer } = require("./bw-utilities-src/i18n/Localizer");
const { Updater } = require("./bw-utilities-src/updater/updater");

const pluginFullMetadata = {
  name: "bwu",
  displayName: "BedWars Utilities",
  prefix: "§6BWU",
  version: "2.0.0",
  author: "Grille (silly_brazil)",
  description:
    "A versatile Bedwars plugin offering a variety of useful features to enhance gameplay.",
  dependencies: [{ name: "denicker", minVersion: "1.1.0" }],
  optionalDependencies: [{ name: "numdenicker", minVersion: "1.0.3" }],
  // Not a proxy thing, dependency from this own plugin (adm-zip to autoupdater and might add more later)
  requiredDependencies: ["adm-zip"],
};

module.exports = function BedWarsUtilitiesPlugin(api) {
  process.on("uncaughtException", (err, _origin) => {
    console.error(`[BWU FATAL] UNHANDLED ERROR: ${err.stack}`);
  });

  const metadataForAPI = {
    name: pluginFullMetadata.name,
    displayName: pluginFullMetadata.displayName,
    prefix: pluginFullMetadata.prefix,
    version: pluginFullMetadata.version,
    author: pluginFullMetadata.author,
    description: pluginFullMetadata.description,
    dependencies: pluginFullMetadata.dependencies,
    optionalDependencies: pluginFullMetadata.optionalDependencies,
  };

  api.metadata(metadataForAPI);

  const localizer = new Localizer(api, {
    defaultLocale: "zh-CN",
    fallbackLocale: "en-US",
  });

  api.t = (key, params, fallback) => localizer.t(key, params, fallback);
  api.tForLocale = (locale, key, params, fallback) =>
    localizer.tForLocale(locale, key, params, fallback);

  const startupLocale = localizer.getConfiguredLocale();
  const configSchema = createConfigSchema((key, params, fallback) =>
    localizer.tForLocale(startupLocale, key, params, fallback)
  );

  api.initializeConfig(configSchema);
  api.configSchema(configSchema);

  const shouldCheckUpdates = api.config.get("updater.checkOnStartup") !== false;
  if (shouldCheckUpdates) {
    try {
      pluginFullMetadata.currentFileName = path.basename(__filename);
      const updater = new Updater(api, pluginFullMetadata);
      updater.checkForUpdates();
    } catch (e) {
      console.error(`[BWU Updater] Failed to start: ${e.message}`);
    }
  }

  const bwu = new BedWarsUtilities(api);
  bwu.registerHandlers();

  return bwu;
};
