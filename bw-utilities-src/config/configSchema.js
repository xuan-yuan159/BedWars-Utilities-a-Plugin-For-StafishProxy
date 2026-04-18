const baseSchema = require("./configSchema.base.json");

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function tFromLocalizer(localizer, key, fallback) {
  if (!localizer) {
    return fallback;
  }

  if (typeof localizer === "function") {
    return localizer(key, null, fallback);
  }

  if (typeof localizer.t === "function") {
    return localizer.t(key, null, fallback);
  }

  return fallback;
}

function localizeDynamicSection(section, sectionIndex, localizer) {
  if (typeof section.label === "string") {
    section.label = tFromLocalizer(
      localizer,
      `config.sections.${sectionIndex}.label`,
      section.label
    );
  }

  if (typeof section.description === "string") {
    section.description = tFromLocalizer(
      localizer,
      `config.sections.${sectionIndex}.description`,
      section.description
    );
  }

  const settings = Array.isArray(section.settings) ? section.settings : [];
  for (let settingIndex = 0; settingIndex < settings.length; settingIndex++) {
    const setting = settings[settingIndex];
    const baseKey = `config.sections.${sectionIndex}.settings.${settingIndex}`;

    if (typeof setting.description === "string") {
      setting.description = tFromLocalizer(
        localizer,
        `${baseKey}.description`,
        setting.description
      );
    }

    if (typeof setting.displayLabel === "string") {
      setting.displayLabel = tFromLocalizer(
        localizer,
        `${baseKey}.displayLabel`,
        setting.displayLabel
      );
    }

    if (typeof setting.placeholder === "string") {
      setting.placeholder = tFromLocalizer(
        localizer,
        `${baseKey}.placeholder`,
        setting.placeholder
      );
    }

    if (Array.isArray(setting.text)) {
      setting.text = setting.text.map((item, textIndex) =>
        typeof item === "string"
          ? tFromLocalizer(localizer, `${baseKey}.text.${textIndex}`, item)
          : item
      );
    }

    if (Array.isArray(setting.values)) {
      setting.values = setting.values.map((item, valueIndex) => {
        if (typeof item?.text !== "string") {
          return item;
        }
        return {
          ...item,
          text: tFromLocalizer(
            localizer,
            `${baseKey}.values.${valueIndex}.text`,
            item.text
          ),
        };
      });
    }
  }

  return section;
}

function createLanguageSection(localizer) {
  return {
    label: tFromLocalizer(localizer, "config.i18n.label", "Language"),
    description: tFromLocalizer(
      localizer,
      "config.i18n.description",
      "Configure plugin language."
    ),
    defaults: {
      i18n: {
        locale: "zh-CN",
      },
    },
    settings: [
      {
        key: "i18n.locale",
        type: "cycle",
        description: tFromLocalizer(
          localizer,
          "config.i18n.locale.description",
          "Select plugin display language."
        ),
        values: [
          {
            text: tFromLocalizer(
              localizer,
              "config.i18n.locale.zhCN",
              "Language: 简体中文"
            ),
            value: "zh-CN",
          },
          {
            text: tFromLocalizer(
              localizer,
              "config.i18n.locale.enUS",
              "Language: English"
            ),
            value: "en-US",
          },
        ],
      },
    ],
  };
}

function createConfigSchema(localizer) {
  const schema = deepClone(baseSchema).map((section, index) =>
    localizeDynamicSection(section, index, localizer)
  );

  schema.unshift(createLanguageSection(localizer));
  return schema;
}

module.exports = createConfigSchema;
