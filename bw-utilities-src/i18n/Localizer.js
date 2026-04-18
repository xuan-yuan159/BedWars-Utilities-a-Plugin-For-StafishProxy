const path = require("node:path");
const fs = require("node:fs");

class Localizer {
  constructor(api, options = {}) {
    this.api = api;
    this.defaultLocale = options.defaultLocale || "zh-CN";
    this.fallbackLocale = options.fallbackLocale || "en-US";
    this.localesDir =
      options.localesDir || path.join(__dirname, "..", "locales");
    this.supportedLocales = new Set(["zh-CN", "en-US"]);
    this.localeCache = new Map();
  }

  _loadLocale(locale) {
    const normalized = this._normalizeLocale(locale);
    if (this.localeCache.has(normalized)) {
      return this.localeCache.get(normalized);
    }

    const filePath = path.join(this.localesDir, `${normalized}.json`);
    let data = {};

    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      console.warn(
        `[BWU i18n] Failed to load locale file ${filePath}: ${error.message}`
      );
      data = {};
    }

    this.localeCache.set(normalized, data);
    return data;
  }

  _normalizeLocale(locale) {
    if (typeof locale !== "string") {
      return this.defaultLocale;
    }

    if (this.supportedLocales.has(locale)) {
      return locale;
    }

    return this.defaultLocale;
  }

  getConfiguredLocale() {
    try {
      const locale = this.api?.config?.get("i18n.locale");
      return this._normalizeLocale(locale);
    } catch (error) {
      return this.defaultLocale;
    }
  }

  _getValue(localeData, key) {
    if (!localeData || typeof localeData !== "object") {
      return undefined;
    }

    if (Object.prototype.hasOwnProperty.call(localeData, key)) {
      return localeData[key];
    }

    if (!key.includes(".")) {
      return undefined;
    }

    let current = localeData;
    const pathParts = key.split(".");
    for (const part of pathParts) {
      if (!current || typeof current !== "object") {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  _interpolate(template, params) {
    if (typeof template !== "string") {
      return template;
    }

    if (!params || typeof params !== "object") {
      return template;
    }

    return template.replaceAll(/\{(\w+)\}/g, (match, token) => {
      if (!Object.prototype.hasOwnProperty.call(params, token)) {
        return match;
      }
      return String(params[token]);
    });
  }

  tForLocale(locale, key, params = null, fallback = null) {
    const normalizedLocale = this._normalizeLocale(locale);
    const primaryData = this._loadLocale(normalizedLocale);
    const fallbackData = this._loadLocale(this.fallbackLocale);

    let value = this._getValue(primaryData, key);
    if (value === undefined) {
      value = this._getValue(fallbackData, key);
    }

    if (value === undefined) {
      value = fallback === null ? key : fallback;
    }

    return this._interpolate(value, params);
  }

  t(key, params = null, fallback = null) {
    return this.tForLocale(this.getConfiguredLocale(), key, params, fallback);
  }
}

module.exports = { Localizer };
