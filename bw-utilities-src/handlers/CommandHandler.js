const path = require("node:path");
const fs = require("node:fs");

class CommandHandler {
  constructor(
    api,
    apiService,
    tabManager,
    chatHandler,
    partyFinder,
    bwuInstance
  ) {
    this.api = api;
    this.apiService = apiService;
    this.tabManager = tabManager;
    this.chatHandler = chatHandler;
    this.partyFinder = partyFinder;
    this.bwu = bwuInstance;
    this.fs = fs;
    const baseDir = process.pkg
      ? path.dirname(process.execPath)
      : path.join(__dirname, "..", "..", "..");

    const dataDir = path.join(baseDir, "data");

    if (!this.fs.existsSync(dataDir)) {
      this.fs.mkdirSync(dataDir, { recursive: true });
    }

    this.macrosFilePath = path.join(dataDir, "bwu_macros.json");

    this.shoutCooldown = 65000;
    this.lastShoutTime = 0;
    this.pendingShoutMessage = null;
    this.shoutTimer = null;
  }

  _t(key, params = null, fallback = null) {
    if (typeof this.api.t === "function") {
      return this.api.t(key, params, fallback ?? key);
    }
    return fallback ?? key;
  }

  _prefixed(key, params = null, fallback = null) {
    return `${this.api.getPrefix()} ${this._t(key, params, fallback)}`;
  }

  _getMacros() {
    try {
      if (this.fs.existsSync(this.macrosFilePath)) {
        const data = this.fs.readFileSync(this.macrosFilePath, "utf8");
        return JSON.parse(data);
      }
    } catch (e) {
      this.api.debugLog(`[BWU] Error reading macros file: ${e.message}`);
      return {};
    }
    return {};
  }

  _saveMacros(macros) {
    try {
      const data = JSON.stringify(macros, null, 2);
      this.fs.writeFileSync(this.macrosFilePath, data, "utf8");
    } catch (e) {
      this.api.debugLog(`[BWU] Error saving macros file: ${e.message}`);
    }
  }

  handleSetMacroCommand(ctx) {
    const name = ctx.args.name;
    const contentArray = ctx.args.content;

    if (!name || !contentArray || contentArray.length === 0) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.usage.setmacro",
          null,
          "Usage: /bwu setmacro <name> <content...>"
        )}`
      );
      return;
    }

    const content = contentArray.join(" ");
    const macros = this._getMacros();

    macros[name.toLowerCase()] = content;

    this._saveMacros(macros);
    this.api.chat(
      `${this.api.getPrefix()} §a${this._t(
        "chat.command.setmacro.saved",
        { name, content },
        `Macro '${name}' saved with content: ${content}`
      )}`
    );
  }

  handleDelMacroCommand(ctx) {
    const name = ctx.args.name;
    if (!name) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.usage.delmacro",
          null,
          "Usage: /bwu delmacro <name>"
        )}`
      );
      return;
    }

    const nameLower = name.toLowerCase();
    const macros = this._getMacros();

    if (macros[nameLower]) {
      delete macros[nameLower];
      this._saveMacros(macros);
      this.api.chat(
        `${this.api.getPrefix()} §a${this._t(
          "chat.command.delmacro.removed",
          { name },
          `Macro '${name}' successfully removed!`
        )}`
      );
    } else {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.delmacro.not_found",
          { name },
          `Macro '${name}' not found.`
        )}`
      );
    }
  }

  handleListMacrosCommand(ctx) {
    const macros = this._getMacros();
    const names = Object.keys(macros);

    if (names.length === 0) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.macros.none",
          null,
          "You have no saved macros. Use /bwu setmacro <name> <content...>"
        )}`
      );
      return;
    }

    this.api.chat(
      `${this.api.getPrefix()} §6${this._t(
        "chat.command.macros.header",
        { count: names.length },
        `Saved Macros (${names.length}):`
      )}`
    );

    for (const name of names) {
      const content = macros[name];

      const chatComponent = {
        text: `§e${name}: §f${content} `,
        extra: [
          {
            text: "§a[Run]",
            color: "green",
            hoverEvent: {
              action: "show_text",
              value: "§aClick to run /bwu m " + name,
            },
            clickEvent: {
              action: "run_command",
              value: `/bwu m ${name}`,
            },
          },
          {
            text: " §e[Edit]",
            color: "yellow",
            hoverEvent: {
              action: "show_text",
              value: "§eClick to edit this macro",
            },
            clickEvent: {
              action: "suggest_command",
              value: `/bwu setmacro ${name} ${content}`,
            },
          },
          {
            text: " §c[Remove]",
            color: "red",
            hoverEvent: {
              action: "show_text",
              value: "§cClick to remove /bwu delmacro " + name,
            },
            clickEvent: {
              action: "run_command",
              value: `/bwu delmacro ${name}`,
            },
          },
        ],
      };
      this.api.chat(chatComponent);
    }
  }

  handleRunMacroCommand(ctx) {
    const name = ctx.args.name;
    if (!name) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.usage.macro_run",
          null,
          "Usage: /bwu m <name>"
        )}`
      );
      return;
    }

    const nameLower = name.toLowerCase();
    const macros = this._getMacros();
    const content = macros[nameLower];

    if (content) {
      this.api.sendChatToServer(content);
    } else {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.macro_run.not_found",
          { name },
          `Macro '${name}' not found. Use /bwu macros to list.`
        )}`
      );
    }
  }

  /**
   * 将 find 命令参数转交给 PartyFinder。
   */
  handleFindCommand(ctx) {
    if (ctx.args.mode && ctx.args.mode.toLowerCase() === "stop") {
      this.partyFinder.stop();
      return;
    }

    const mode = ctx.args.mode;
    const playersToFind = ctx.args.playersToFind;
    const fkdrThreshold = ctx.args.fkdrThreshold;
    const starsThreshold = ctx.args.starsThreshold;
    const positions = ctx.args.positions || [];

    const args = [mode, playersToFind, fkdrThreshold, starsThreshold, ...positions]; // 传递 FKDR 与最低星数阈值

    this.partyFinder.start(args);
  }

  async handleStatsCommand(ctx) {
    const playerName = ctx.args.nickname;

    if (
      !playerName ||
      typeof playerName !== "string" ||
      playerName.trim().length === 0
    ) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.usage.stats",
          null,
          "Usage: /bwu stats <nickname>"
        )}`
      );
      return;
    }

    await this.chatHandler.displayStatsForPlayer(playerName.trim());
  }

  handleSetThresholdCommand(ctx) {
    const threshold = ctx.args.threshold;

    const numericThreshold = Number.parseFloat(threshold);

    if (Number.isNaN(numericThreshold) || numericThreshold < 0) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.setthreshold.invalid",
          null,
          "Error: Please provide a valid number for the threshold (e.g., 10.0)."
        )}`
      );
      return;
    }

    this.api.config.set("autoRequeue.fkdrThreshold", numericThreshold);

    this.api.chat(`${this.api.getPrefix()} §a${this._t(
      "chat.command.setthreshold.updated",
      { value: numericThreshold.toFixed(2) },
      `FKDR threshold for auto-requeue set to ${numericThreshold.toFixed(2)}.`
    )}`);
  }

  handleClearCommand(ctx) {
    this.tabManager.clearManagedPlayers("all");
    this.api.chat(
      `${this.api.getPrefix()} §a${this._t(
        "chat.command.clearstats.success",
        null,
        "Stats cleared successfully!"
      )}`
    );
  }

  /**
   * 保存 NetherApi API Key
   */
  handleSetKeyCommand(ctx) {
    const apikey = ctx.args.apikey;

    if (!apikey || typeof apikey !== "string") {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.api_key.invalid",
          null,
          "Error: Please provide a valid API key!"
        )}`
      );
      return;
    }

    const trimmedKey = apikey.trim();
    if (trimmedKey.length === 0) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.api_key.empty",
          null,
          "Error: The key cannot be empty!"
        )}`
      );
      return;
    }

    this.api.config.set("main.netherApiKey", trimmedKey); // 保存 NetherApi API Key
    this.api.chat(
      `${this.api.getPrefix()} §a${this._t(
        "chat.command.api_key.nether_set",
        null,
        "NetherApi API key set successfully!"
      )}`
    );
  }

  handleSetAuroraCommand(ctx) {
    const apikey = ctx.args.apikey;

    if (!apikey || typeof apikey !== "string") {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.api_key.invalid",
          null,
          "Error: Please provide a valid API key!"
        )}`
      );
      return;
    }

    const trimmedKey = apikey.trim();
    if (trimmedKey.length === 0) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.api_key.empty",
          null,
          "Error: The key cannot be empty!"
        )}`
      );
      return;
    }

    this.api.config.set("main.auroraApiKey", trimmedKey);
    this.api.chat(
      `${this.api.getPrefix()} §a${this._t(
        "chat.command.api_key.aurora_set",
        null,
        "Aurora API key set successfully!"
      )}`
    );
  }

  /**
   * 保存 Urchin API Key，供等待大厅的自动标签查询使用。
   */
  handleSetUrchinCommand(ctx) {
    const apikey = ctx.args.apikey;

    if (!apikey || typeof apikey !== "string") {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.api_key.invalid",
          null,
          "Error: Please provide a valid API key!"
        )}`
      );
      return;
    }

    const trimmedKey = apikey.trim();
    if (trimmedKey.length === 0) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.api_key.empty",
          null,
          "Error: The key cannot be empty!"
        )}`
      );
      return;
    }

    this.api.config.set("main.urchinApiKey", trimmedKey); // 保存 Urchin API Key
    this.api.chat(
      `${this.api.getPrefix()} §a${this._t(
        "chat.command.api_key.urchin_set",
        null,
        "Urchin API key set successfully!"
      )}`
    );
  }

  sendQdMessage(slot) {
    if (!slot || slot < 1 || slot > 5) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.slot.invalid",
          null,
          "Invalid slot. Use a number from 1 to 5."
        )}`
      );
      return;
    }

    const message = this.api.config.get(`autoQdmsg.msg${slot}`);
    if (!message || message.trim().length === 0) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.qdmsg.slot_empty",
          { slot },
          `Slot ${slot} is empty. Use /bwu setqdmsg ${slot} <message> to save.`
        )}`
      );
      return;
    }

    this.api.sendChatToServer(`/ac ${message}`);
  }

  handleQdmsgCommand(ctx) {
    const slot = Number.parseInt(ctx.args.slot, 10);
    if (Number.isNaN(slot)) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.usage.qdmsg",
          null,
          "Usage: /bwu qdmsg <slot_number: 1-5>"
        )}`
      );
      return;
    }
    this.sendQdMessage(slot);
  }

  handleSetQdmsgCommand(ctx) {
    const slot = Number.parseInt(ctx.args.slot, 10);
    const messageArray = ctx.args.message;

    if (Number.isNaN(slot) || slot < 1 || slot > 5) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.usage.setqdmsg",
          null,
          "Usage: /bwu setqdmsg <slot: 1-5> <message>"
        )}`
      );
      return;
    }

    let finalMessage = "";
    if (Array.isArray(messageArray) && messageArray.length > 0) {
      finalMessage = messageArray.join(" ");
    }

    if (finalMessage.length === 0) {
      this.api.config.set(`autoQdmsg.msg${slot}`, "");
      this.api.chat(
        `${this.api.getPrefix()} §a${this._t(
          "chat.command.slot.cleared",
          { slot },
          `Message from Slot ${slot} has been cleared.`
        )}`
      );
      return;
    }

    this.api.config.set(`autoQdmsg.msg${slot}`, finalMessage);
    this.api.chat(
      `${this.api.getPrefix()} §a${this._t(
        "chat.command.slot.saved",
        { slot, message: finalMessage },
        `Slot ${slot} saved: ${finalMessage}`
      )}`
    );
  }

  handleListQdmsgCommand(_ctx) {
    this.api.chat(
      `${this.api.getPrefix()} §6${this._t(
        "chat.command.qdmsg.header",
        null,
        "Saved Messages (Queue Dodge):"
      )}`
    );
    let hasMessages = false;
    for (let i = 1; i <= 5; i++) {
      const msg = this.api.config.get(`autoQdmsg.msg${i}`);
      if (msg && msg.trim().length > 0) {
        hasMessages = true;
        const chatComponent = {
          text: `§eSlot ${i}: §f${msg} `,
          extra: [
            {
              text: "§7[Send]",
              color: "gray",
              hoverEvent: {
                action: "show_text",
                value: "§aClick to send this message",
              },
              clickEvent: {
                action: "run_command",
                value: `/bwu qdmsg ${i}`,
              },
            },
            {
              text: " §c[Edit]",
              color: "red",
              hoverEvent: {
                action: "show_text",
                value: "§eClick to edit this message",
              },
              clickEvent: {
                action: "suggest_command",
                value: `/bwu setqdmsg ${i} ${msg}`,
              },
            },
          ],
        };
        this.api.chat(chatComponent);
      } else {
        this.api.chat(`§eSlot ${i}: §7[Empty]`);
      }
    }
    if (!hasMessages) {
      this.api.chat(
        `§c${this._t(
          "chat.command.qdmsg.none",
          null,
          "No saved messages. Use /bwu setqdmsg <1-5> <message>"
        )}`
      );
    }
  }

  sendSnipedMessage(slot, channel) {
    if (!slot || slot < 1 || slot > 5) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.slot.invalid",
          null,
          "Invalid slot. Use a number from 1 to 5."
        )}`
      );
      return;
    }

    const message = this.api.config.get(`snipedMsg.msg${slot}`);
    if (!message || message.trim().length === 0) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.sniped.slot_empty",
          { slot },
          `Slot ${slot} is empty. Use /bwu setsniped ${slot} <message> to save.`
        )}`
      );
      return;
    }

    const commandPrefix =
      channel && channel.toLowerCase() === "ac" ? "/ac" : "/shout";

    if (commandPrefix === "/shout") {
      this.sendShoutWithCooldown(message);
    } else {
      this.api.sendChatToServer(`${commandPrefix} ${message}`);
    }
  }  sendShoutWithCooldown(message) {
    const now = Date.now();
    const timeSinceLastShout = now - this.lastShoutTime;
    const remainingCooldown = this.shoutCooldown - timeSinceLastShout;

    if (timeSinceLastShout >= this.shoutCooldown) {
      // Cooldown is over, send immediately
      this.bwu._bypassShoutInterception = true;
      this.api.sendChatToServer(`/shout ${message}`);
      this.lastShoutTime = now;
      this.pendingShoutMessage = null;

      if (this.shoutTimer) {
        clearTimeout(this.shoutTimer);
        this.shoutTimer = null;
      }
    } else {
      // Cooldown active, queue the message
      this.pendingShoutMessage = message;

      if (this.shoutTimer) {
        clearTimeout(this.shoutTimer);
      }      // Use arrow function to preserve 'this' context
      this.api.debugLog(`[BWU] Queuing shout: "${message}", will send in ${remainingCooldown}ms`);
      this.shoutTimer = setTimeout(() => {
        this.api.debugLog(`[BWU] Shout timer fired! Pending message: "${this.pendingShoutMessage}"`);
        if (this.pendingShoutMessage) {
          this.bwu._bypassShoutInterception = true;
          this.api.sendChatToServer(`/shout ${this.pendingShoutMessage}`);
          this.api.debugLog(`[BWU] Queued shout sent: "${this.pendingShoutMessage}"`);
          this.lastShoutTime = Date.now();
          this.pendingShoutMessage = null;
          this.shoutTimer = null;
        }
      }, remainingCooldown);

      const secondsLeft = Math.round(remainingCooldown / 1000);
      this.api.chat(
        `${this.api.getPrefix()} §eQueued message: §f"${message}"`
      );
      this.api.chat(
        `${this.api.getPrefix()} §eWill send in §f${secondsLeft}s §e(cooldown active)`
      );
    }
  }
  cancelPendingShout() {
    if (this.shoutTimer) {
      clearTimeout(this.shoutTimer);
      this.shoutTimer = null;
      this.pendingShoutMessage = null;
      return true;
    }
    return false;
  }

  handleSnipedCommand(ctx) {
    const slot = Number.parseInt(ctx.args.slot, 10);
    const channel = ctx.args.channel;

    if (Number.isNaN(slot)) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.usage.sniped",
          null,
          "Usage: /bwu sniped <slot_number: 1-5> [ac]"
        )}`
      );
      return;
    }
    this.sendSnipedMessage(slot, channel);
  }

  handleSetSnipedCommand(ctx) {
    const slot = Number.parseInt(ctx.args.slot, 10);
    const messageArray = ctx.args.message;

    if (Number.isNaN(slot) || slot < 1 || slot > 5) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.usage.setsniped",
          null,
          "Usage: /bwu setsniped <slot: 1-5> <message>"
        )}`
      );
      return;
    }

    let finalMessage = "";
    if (Array.isArray(messageArray) && messageArray.length > 0) {
      finalMessage = messageArray.join(" ");
    }

    if (finalMessage.length === 0) {
      this.api.config.set(`snipedMsg.msg${slot}`, "");
      this.api.chat(
        `${this.api.getPrefix()} §a${this._t(
          "chat.command.slot.cleared",
          { slot },
          `Message from Slot ${slot} has been cleared.`
        )}`
      );
      return;
    }

    this.api.config.set(`snipedMsg.msg${slot}`, finalMessage);
    this.api.chat(
      `${this.api.getPrefix()} §a${this._t(
        "chat.command.slot.saved",
        { slot, message: finalMessage },
        `Slot ${slot} saved: ${finalMessage}`
      )}`
    );
  }

  handleListSnipedCommand(_ctx) {
    this.api.chat(
      `${this.api.getPrefix()} §6${this._t(
        "chat.command.sniped.header",
        null,
        "Saved Messages (Sniped):"
      )}`
    );
    let hasMessages = false;
    for (let i = 1; i <= 5; i++) {
      const msg = this.api.config.get(`snipedMsg.msg${i}`);
      if (msg && msg.trim().length > 0) {
        hasMessages = true;
        const chatComponent = {
          text: `§eSlot ${i}: §f${msg} `,
          extra: [
            {
              text: "§7[Send]",
              color: "gray",
              hoverEvent: {
                action: "show_text",
                value: "§aClick to send this message",
              },
              clickEvent: {
                action: "run_command",
                value: `/bwu sniped ${i}`,
              },
            },
            {
              text: " §c[Edit]",
              color: "red",
              hoverEvent: {
                action: "show_text",
                value: "§eClick to edit this message",
              },
              clickEvent: {
                action: "suggest_command",
                value: `/bwu setsniped ${i} ${msg}`,
              },
            },
          ],
        };
        this.api.chat(chatComponent);
      } else {
        this.api.chat(`§eSlot ${i}: §7[Empty]`);
      }
    }
    if (!hasMessages) {
      this.api.chat(
        `§c${this._t(
          "chat.command.sniped.none",
          null,
          "No saved messages. Use /bwu setsniped <1-5> <message>"
        )}`
      );
    }
  }

  handlePingCommand(_ctx) {
    try {
      const player = this.api.getCurrentPlayer();
      if (!player?.uuid) {
        this.api.chat(
          `${this.api.getPrefix()} §cCould not retrieve your player data.`
        );
        return;
      }

      const playerInfo = this.api.getPlayerInfo(player.uuid);

      if (playerInfo?.ping === undefined) {
        this.api.chat(
          `${this.api.getPrefix()} §cCould not retrieve your ping at this time.`
        );
      } else {
        this.api.chat(
          `${this.api.getPrefix()} §aYour ping is: §f${playerInfo.ping}ms`
        );
      }
    } catch (e) {
      this.api.chat(
        `${this.api.getPrefix()} §cAn error occurred while fetching ping: ${
          e.message
        }`
      );
      console.error(`[BWU Ping Error]: ${e.stack}`);
    }
  }

  async handleMcnamesCommand(ctx) {
    const playerName = ctx.args.ign;

    if (!playerName || typeof playerName !== "string") {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.usage.mcnames",
          null,
          "Usage: /bwu mcnames <ign>"
        )}`
      );
      return;
    }

    try {
      this.api.chat(
        `${this.api.getPrefix()} §7${this._t(
          "chat.command.mcnames.fetching",
          { player: playerName },
          `Fetching name history for ${playerName}...`
        )}`
      );

      const nameData = await this.apiService.getNameHistory(playerName);

      if (!nameData) {
        this.api.chat(
          `${this.api.getPrefix()} §cCouldn't find name history for §f${playerName}§c.`
        );
        return;
      }

      this.api.chat(
        `${this.api.getPrefix()} §a${this._t(
          "chat.command.mcnames.current_name",
          { name: nameData.currentName },
          `Current name: ${nameData.currentName}`
        )}`
      );
      this.api.chat(`${this.api.getPrefix()} §7UUID: §f${nameData.uuid}`);

      if (nameData.history.length > 0) {
        this.api.chat(
          `${this.api.getPrefix()} §6${this._t(
            "chat.command.mcnames.history_header",
            { count: nameData.history.length },
            `Name History (${nameData.history.length} names):`
          )}`
        );

        nameData.history.forEach((entry, index) => {
          const dateStr = entry.changedAt
            ? new Date(entry.changedAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "Original";

          const accurateTag = entry.accurate ? "§a✓" : "§c✗";
          const lastSeen = entry.lastSeenAt
            ? ` §8(Last seen: ${new Date(entry.lastSeenAt).toLocaleDateString(
                "en-US",
                {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                }
              )})`
            : "";

          this.api.chat(
            `${this.api.getPrefix()} §7${index + 1}. §f${
              entry.name
            } §7- §e${dateStr} ${accurateTag}${lastSeen}`
          );
        });
      } else {
        this.api.chat(
          `${this.api.getPrefix()} §7${this._t(
            "chat.command.mcnames.no_history",
            null,
            "No name history found."
          )}`
        );
      }
    } catch (e) {
      this.api.chat(
        `${this.api.getPrefix()} §cAn error occurred while fetching name history: ${
          e.message
        }`
      );
      console.error(`[BWU Mcnames Error]: ${e.stack}`);
    }
  }

  handleSetInPartyCommand(ctx) {
    const value = ctx.args.value;

    if (!value) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.usage.setinparty",
          null,
          "Usage: /bwu setinparty <true|false>"
        )}`
      );
      return;
    }

    const valueLower = value.toLowerCase();

    if (valueLower === "true") {
      this.bwu.inParty = true;
      this.api.chat(
        `${this.api.getPrefix()} §a[DEBUG] inParty set to §ftrue`
      );
    } else if (valueLower === "false") {
      this.bwu.inParty = false;
      this.api.chat(
        `${this.api.getPrefix()} §a[DEBUG] inParty set to §ffalse`
      );
    } else {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.setinparty.invalid",
          null,
          "Invalid value. Use true or false."
        )}`
      );
    }
  }
  async handleRerankCommand(ctx) {
    try {
      this.api.chat(
        `${this.api.getPrefix()} §e${this._t(
          "chat.command.rerank.refreshing",
          null,
          "Refreshing team ranking and tab list..."
        )}`
      );

      // Clear existing tab stats
      this.tabManager.clearManagedPlayers("all");

      // Reset ranking sent flag to allow re-ranking
      this.bwu.rankingSentThisMatch = false;
      // Force ranking run on next ONLINE list, even if gameStarted is stale
      this.bwu.forceRankingOnNextWho = true;

      // Send /who command to trigger the ranking and tab refresh
      // The existing onChat handler will process the response
      this.api.sendChatToServer("/who");
    } catch (error) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.rerank.error",
          { error: error.message },
          `Error during rerank: ${error.message}`
        )}`
      );
      console.error(`[BWU] Rerank error: ${error.stack}`);
    }
  }  async handleAllStatsCommand(ctx) {
    try {
      const colorFilter = ctx.args.color?.toLowerCase();
      const sendTo = ctx.args.sendTo?.toLowerCase() || "private";

      // Validate sendTo argument
      if (!["private", "team", "party"].includes(sendTo)) {
        this.api.chat(
          `${this.api.getPrefix()} §c${this._t(
            "chat.command.allstats.invalid_send_to",
            null,
            "Invalid sendTo option! Use: private, team, or party"
          )}`
        );
        return;
      }

      // Check if we're in a party when sendTo is party
      if (sendTo === "party" && this.bwu.inParty !== true) {
        this.api.chat(
          `${this.api.getPrefix()} §c${this._t(
            "chat.command.allstats.must_be_in_party",
            null,
            "You must be in a party to send to party chat!"
          )}`
        );
        return;
      }

      // Map color names to team letter codes
      const colorMap = {
        red: "R",
        blue: "B",
        green: "G",
        yellow: "Y",
        aqua: "A",
        white: "W",
        pink: "P",
        gray: "S",
        grey: "S", // Alternative spelling
      };

      const teamNames = {
        R: "Red",
        B: "Blue",
        G: "Green",
        Y: "Yellow",
        A: "Aqua",
        W: "White",
        P: "Pink",
        S: "Gray",
      };

      // Get all players from TabManager (these are the players from last /who)
      const managedPlayers = Array.from(this.tabManager.managedPlayers.keys());
      
      if (managedPlayers.length === 0) {
        this.api.chat(
          `${this.api.getPrefix()} §c${this._t(
            "chat.command.allstats.no_players",
            null,
            "No players tracked. Try running /who or wait for a game to start!"
          )}`
        );
        return;
      }

      let playersToShow = [];

      // If color filter is specified, validate and filter
      if (colorFilter) {
        const teamLetter = colorMap[colorFilter];
        
        if (!teamLetter) {
          this.api.chat(
            `${this.api.getPrefix()} §c${this._t(
              "chat.command.allstats.invalid_color",
              null,
              "Invalid color! Valid colors: red, blue, green, yellow, aqua, white, pink, gray"
            )}`
          );
          return;
        }

        // Filter players by team color
        for (const playerName of managedPlayers) {
          const team = this.api.getPlayerTeam(playerName);
          const playerTeamLetter = this._getTeamLetter(team?.prefix);
          
          if (playerTeamLetter === teamLetter) {
            playersToShow.push(playerName);
          }
        }

        if (playersToShow.length === 0) {
          this.api.chat(
            `${this.api.getPrefix()} §c${this._t(
              "chat.command.allstats.no_players_on_team",
              { team: teamNames[teamLetter] },
              `No players found on ${teamNames[teamLetter]} team!`
            )}`
          );
          return;
        }

        const modeText = sendTo === "private" ? "privately" : sendTo === "team" ? "in team chat" : "in party chat";
        this.api.chat(
          `${this.api.getPrefix()} §e${this._t(
            "chat.command.allstats.showing_team",
            { count: playersToShow.length, team: teamNames[teamLetter], mode: modeText },
            `Showing stats for ${playersToShow.length} players on ${teamNames[teamLetter]} team ${modeText}...`
          )}`
        );
      } else {
        // Show all players
        playersToShow = managedPlayers;
        const modeText = sendTo === "private" ? "privately" : sendTo === "team" ? "in team chat" : "in party chat";
        this.api.chat(
          `${this.api.getPrefix()} §e${this._t(
            "chat.command.allstats.showing_all",
            { count: playersToShow.length, mode: modeText },
            `Showing stats for ${playersToShow.length} players ${modeText}...`
          )}`
        );
      }

      // Display stats for each player
      for (const playerName of playersToShow) {
        // Get real name if nicked
        const realName =
          this.bwu.resolvedNicks.get(playerName.toLowerCase()) || playerName;

        // Fetch stats
        const stats = await this.apiService.getPlayerStats(realName);
        
        let ping = null;
        if (this.api.config.get("stats.showPing.enabled")) {
          const uuid = await this.apiService.getUuid(realName);
          if (uuid) {
            ping = await this.apiService.getPlayerPing(uuid);
          }
        }

        // Format stats message
        const message = this.bwu.statsFormatter.formatStats(
          "chat",
          playerName,
          stats,
          ping,
          { includePrefix: false }
        );

        // Send to appropriate channel
        if (sendTo === "private") {
          this.api.chat(message);
        } else {
          const cleanMessage = message.replaceAll(/§[0-9a-fk-or]/g, "");
          if (sendTo === "team") {
            this.api.sendChatToServer(`/ac ${cleanMessage}`);
          } else if (sendTo === "party") {
            this.api.sendChatToServer(`/pc ${cleanMessage}`);
          }
        }

        // Small delay to avoid spam
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    } catch (error) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.allstats.error",
          { error: error.message },
          `Error showing stats: ${error.message}`
        )}`
      );
      console.error(`[BWU] AllStats error: ${error.stack}`);
    }
  }

  _getTeamLetter(rawPrefix) {
    if (!rawPrefix) return null;
    const match = rawPrefix.match(/[A-Z]/);
    return match ? match[0] : null;
  }

  handleGameStatsCommand(ctx) {
    this.bwu.inGameTracker.displayGameStats();
  }
  handlePlayerStatsCommand(ctx) {
    const playerName = ctx.args.player;
    if (!playerName) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.command.usage.playerstats",
          null,
          "Usage: /bwu playerstats <player>"
        )}`
      );
      return;
    }
    this.bwu.inGameTracker.displayPlayerStats(playerName);
  }

  handleGameTabCommand(ctx) {
    const setting = ctx.args.setting?.toLowerCase();
    const value = ctx.args.value;

    // If no args, show current settings
    if (!setting) {
      const showInTab = this.api.config.get("inGameTracker.showInTab");
      const delay = this.api.config.get("inGameTracker.tabDelay");
      const showKills = this.api.config.get("inGameTracker.tabShowKills");
      const showDeaths = this.api.config.get("inGameTracker.tabShowDeaths");
      const showFK = this.api.config.get("inGameTracker.tabShowFinalKills");
      const showBB = this.api.config.get("inGameTracker.tabShowBedBreaks");

      this.api.chat(
        `${this.api.getPrefix()} §6§l═══ ${this._t(
          "chat.command.gametab.header",
          null,
          "Game Tab Settings"
        )} ═══`
      );
      this.api.chat(`  §7Show In Tab: ${showInTab ? "§aON" : "§cOFF"}`);
      this.api.chat(`  §7Delay: §e${delay}s`);
      this.api.chat(`  §7Show Kills: ${showKills ? "§aON" : "§cOFF"}`);
      this.api.chat(`  §7Show Deaths: ${showDeaths ? "§aON" : "§cOFF"}`);
      this.api.chat(`  §7Show Final Kills: ${showFK ? "§aON" : "§cOFF"}`);
      this.api.chat(`  §7Show Bed Breaks: ${showBB ? "§aON" : "§cOFF"}`);
      this.api.chat(
        `  §8${this._t(
          "chat.command.usage.gametab",
          null,
          "Usage: /bwu gametab <on|off|kills|deaths|fk|bb|delay> [value]"
        )}`
      );
      return;
    }

    switch (setting) {
      case "on":
        this.api.config.set("inGameTracker.showInTab", true);
        this.api.chat(
          `${this.api.getPrefix()} §a${this._t(
            "chat.command.gametab.enabled",
            null,
            "Game stats in tab enabled!"
          )}`
        );
        // Start alternation if game is in progress
        if (this.bwu.inGameTracker.isTracking) {
          this.bwu.tabManager.startTabAlternation();
        }
        break;

      case "off":
        this.api.config.set("inGameTracker.showInTab", false);
        this.api.chat(
          `${this.api.getPrefix()} §c${this._t(
            "chat.command.gametab.disabled",
            null,
            "Game stats in tab disabled!"
          )}`
        );
        this.bwu.tabManager.stopTabAlternation();
        break;

      case "kills":
        const newKills = !this.api.config.get("inGameTracker.tabShowKills");
        this.api.config.set("inGameTracker.tabShowKills", newKills);
        this.api.chat(`${this.api.getPrefix()} §7Show Kills: ${newKills ? "§aON" : "§cOFF"}`);
        break;

      case "deaths":
        const newDeaths = !this.api.config.get("inGameTracker.tabShowDeaths");
        this.api.config.set("inGameTracker.tabShowDeaths", newDeaths);
        this.api.chat(`${this.api.getPrefix()} §7Show Deaths: ${newDeaths ? "§aON" : "§cOFF"}`);
        break;

      case "fk":
        const newFK = !this.api.config.get("inGameTracker.tabShowFinalKills");
        this.api.config.set("inGameTracker.tabShowFinalKills", newFK);
        this.api.chat(`${this.api.getPrefix()} §7Show Final Kills: ${newFK ? "§aON" : "§cOFF"}`);
        break;

      case "bb":
        const newBB = !this.api.config.get("inGameTracker.tabShowBedBreaks");
        this.api.config.set("inGameTracker.tabShowBedBreaks", newBB);
        this.api.chat(`${this.api.getPrefix()} §7Show Bed Breaks: ${newBB ? "§aON" : "§cOFF"}`);
        break;

      case "delay":
        const delayVal = parseInt(value);
        if (isNaN(delayVal) || delayVal < 5 || delayVal > 10) {
          this.api.chat(
            `${this.api.getPrefix()} §c${this._t(
              "chat.command.gametab.delay_invalid",
              null,
              "Delay must be between 5 and 10 seconds."
            )}`
          );
          return;
        }
        this.api.config.set("inGameTracker.tabDelay", delayVal);
        this.api.chat(`${this.api.getPrefix()} §7Tab delay set to §e${delayVal}s`);
        // Restart alternation with new delay if running
        if (this.bwu.tabManager.tabAlternationInterval) {
          this.bwu.tabManager.stopTabAlternation();
          this.bwu.tabManager.startTabAlternation();
        }
        break;

      default:
        this.api.chat(
          `${this.api.getPrefix()} §c${this._t(
            "chat.command.gametab.unknown_setting",
            { setting },
            `Unknown setting: ${setting}`
          )}`
        );
        this.api.chat(
          `${this.api.getPrefix()} §7${this._t(
            "chat.command.usage.gametab",
            null,
            "Usage: /bwu gametab <on|off|kills|deaths|fk|bb|delay> [value]"
          )}`
        );
    }
  }
}

module.exports = CommandHandler;
