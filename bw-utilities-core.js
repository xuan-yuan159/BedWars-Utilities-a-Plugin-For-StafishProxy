const path = require("node:path");
// Patcher need to be first, unless it wont work; lets bypass starfish :fire:
require("./bw-utilities-src/core/patcher");

const BedWarsUtilities = require("./bw-utilities-src/BedWarsUtilities");
const createConfigSchema = require("./bw-utilities-src/config/configSchema");
const { Localizer } = require("./bw-utilities-src/i18n/Localizer");
const UPDATER_ENABLE_ENV_KEY = "BWU_ENABLE_UPDATER";

function resolveBooleanSetting(value, defaultValue = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "enabled"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", "disabled"].includes(normalized)) {
      return false;
    }
  }

  return defaultValue;
}

function isUpdaterRuntimeEnabled() {
  return resolveBooleanSetting(process.env[UPDATER_ENABLE_ENV_KEY], false);
}

const pluginFullMetadata = {
  name: "bwu",
  displayName: "BedWars Utilities",
  prefix: "§6BWU",
  version: "2.1.0", // 插件发布版本
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

  const updaterCheckOnStartupRaw = api.config.get("updater.checkOnStartup");
  const legacyUpdaterEnabledRaw = api.config.get("updater.enabled");
  const updaterSettingRaw =
    updaterCheckOnStartupRaw !== undefined
      ? updaterCheckOnStartupRaw
      : legacyUpdaterEnabledRaw;
  const updaterRuntimeEnabled = isUpdaterRuntimeEnabled();
  const updaterConfigEnabled = resolveBooleanSetting(updaterSettingRaw, false);
  const shouldCheckUpdates = updaterRuntimeEnabled && updaterConfigEnabled;

  if (shouldCheckUpdates) {
    try {
      const { Updater } = require("./bw-utilities-src/updater/updater");
      pluginFullMetadata.currentFileName = path.basename(__filename);
      const updater = new Updater(api, pluginFullMetadata);
      updater.checkForUpdates();
    } catch (e) {
      console.error(`[BWU Updater] Failed to start: ${e.message}`);
    }
  } else if (!updaterRuntimeEnabled) {
    console.log(
      `[BWU Updater] Disabled by runtime lock. Set ${UPDATER_ENABLE_ENV_KEY}=true to enable.`
    );
  }

  const bwu = new BedWarsUtilities(api);
  bwu.registerHandlers();

  return bwu;
};
