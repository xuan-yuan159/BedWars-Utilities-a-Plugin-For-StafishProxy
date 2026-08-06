class ChatHandler {
  constructor(api, apiService, statsFormatter, tabManager, bwuInstance) {
    this.api = api;
    this.apiService = apiService;
    this.statsFormatter = statsFormatter;
    this.tabManager = tabManager;
    this.bwuInstance = bwuInstance;
  }

  _t(key, params = null, fallback = null) {
    if (typeof this.api.t === "function") {
      return this.api.t(key, params, fallback ?? key);
    }
    return fallback ?? key;
  }

  /**
   * 解析聊天消息，并处理赛前大厅的自动战绩、标签和自动重进流程。
   */
  async handleChat(
    cleanMessage,
    autoStatsMode,
    checkedPlayers,
    setAutoStatsMode
  ) {
    const me = this.api.getCurrentPlayer();
    if (!me?.uuid) return;
    const myNick = this.api.getPlayerInfo(me.uuid)?.name || me.name;

    // Auto Stats Mode
    if (this.api.config.get("autoStats.enabled") && !autoStatsMode) {
      const joinRegex = new RegExp(`^${myNick} has joined \\([0-9]+\\/[0-9]+\\)!$`);
      if (joinRegex.test(cleanMessage)) {
        setAutoStatsMode(true);
        checkedPlayers.clear();
        let sendType = this.api.config.get("autoStats.sendType") || "private";
        // If party mode but not in party, fallback to private
        if (sendType === "party" && this.bwuInstance.inParty !== true) {
          sendType = "private";
          this.api.debugLog(`[BWU] Auto Stats sendType: party -> private (not in party)`);
        } else {
          this.api.debugLog(`[BWU] Auto Stats sendType: ${sendType}`);
        }
        let modeText =
          sendType === "party"
            ? this._t("chat.auto_stats.party_mode", null, "Party Mode")
            : this._t("chat.auto_stats.private_mode", null, "Private Mode");
        const enabledMsg = `${this.api.getPrefix()} §a${this._t(
          "chat.auto_stats.enabled",
          { mode: modeText },
          `Automatic stats mode ENABLED (${modeText})`
        )}`;
        this.api.chat(enabledMsg);
        return;
      }
    }

    const chatRegex = /^(?:\[.*?\]\s*)*(\w{3,16})(?::| ») (.*)/;
    const match = cleanMessage.match(chatRegex);
    if (!match) return;

    const senderName = match[1];
    const messageContent = match[2];

    if (autoStatsMode && !checkedPlayers.has(senderName.toLowerCase())) {
      const stats = await this.displayStatsForPlayer(senderName);

      if (
        stats &&
        !stats.isNicked &&
        this.api.config.get("autoStats.checkTags")
      ) {
        // 仅在成功获取真实战绩后继续查询 Urchin 标签
        await this.displayAutoTagsForPlayer(senderName);
      }

      checkedPlayers.add(senderName.toLowerCase());

      const autoRequeueConfig = this.api.config.get("autoRequeue");

      if (autoRequeueConfig?.enabled && !this.bwuInstance.requeueTriggered) {
        if (
          stats &&
          !stats.isNicked &&
          stats.fkdr > autoRequeueConfig.fkdrThreshold
        ) {
          this.bwuInstance.requeueTriggered = true;

          this.api.chat(
            `${this.api.getPrefix()} §c${this._t(
              "chat.auto_requeue.triggered",
              {
                player: senderName,
                fkdr: stats.fkdr.toFixed(2),
                threshold: autoRequeueConfig.fkdrThreshold,
              },
              `Auto Requeue: ${senderName} has ${stats.fkdr.toFixed(
                2
              )} FKDR (limit: ${autoRequeueConfig.fkdrThreshold}).`
            )}`
          );

          this.api.sendChatToServer("/requeue");
        }
      }
    }

    if (this.api.config.get("mentionStats.enabled")) {
      if (messageContent.toLowerCase().includes(myNick.toLowerCase())) {
        await this.displayStatsForPlayer(senderName);
      }
    }
  }

  /**
   * 按自动战绩的发送配置将消息投递到组队频道或本地聊天栏。
   * @param {string} message 要发送的消息
   */
  _sendAutoStatsMessage(message) {
    const sendType = this.api.config.get("autoStats.sendType") || "private";

    if (sendType === "party" && this.bwuInstance.inParty === true) {
      this.api.debugLog(`[BWU] Automatic result sending to party chat`);
      const cleanMessage = message.replaceAll(/§[0-9a-fk-or]/g, ""); // 组队聊天不发送 Minecraft 颜色代码
      this.api.sendChatToServer(`/pc ${cleanMessage}`);
    } else if (sendType === "party") {
      this.api.debugLog(
        `[BWU] Auto Stats sendType: party -> private (not in party)`
      );
      this.api.chat(message);
    } else {
      this.api.chat(message);
    }
  }

  /**
   * 查询并输出玩家的 Urchin 标签；没有标签或查询失败时不显示消息。
   * @param {string} playerName 玩家名称
   */
  async displayAutoTagsForPlayer(playerName) {
    const tags = await this.apiService.getPlayerTags(playerName);
    if (!Array.isArray(tags) || tags.length === 0) {
      return;
    }

    const reasons = tags
      .map((tag) => {
        const reason = typeof tag?.reason === "string" ? tag.reason.trim() : "";
        return reason || "unknown"; // 空标签理由使用统一的英文占位文本
      })
      .join("; ");
    const message = this._t(
      "chat.auto_tag.found",
      { player: playerName, reasons },
      `⚠ ${playerName} has tags: ${reasons}`
    );

    this._sendAutoStatsMessage(message); // 标签结果与战绩使用完全相同的投递渠道
  }

  /**
   * 查询、格式化并显示玩家战绩，同时返回已获取的战绩对象。
   * @param {string} playerName 玩家名称
   * @returns {Promise<object | null>} 查询到的战绩；失败时返回 null
   */
  async displayStatsForPlayer(playerName) {
    const stats = await this.apiService.getPlayerStats(playerName);

    if (!stats) {
      this.api.chat(
        `${this.api.getPrefix()} §c${this._t(
          "chat.stats.fetch_failed",
          { player: playerName },
          `Failed to fetch stats for ${playerName}.`
        )}`
      );
      return null;
    }

    let ping = null;
    if (this.api.config.get("stats.showPing")) {
      const uuid = await this.apiService.getUuid(playerName);
      if (uuid) {
        ping = await this.apiService.getPlayerPing(uuid);
      }
    }

    const sendType = this.api.config.get("autoStats.sendType") || "private";

    // 本地聊天显示插件前缀，组队聊天不显示前缀
    const includePrefix = !(sendType === "party" && this.bwuInstance.inParty === true);

    const message = this.statsFormatter.formatStats(
      "chat",
      playerName,
      stats,
      ping,
      { includePrefix }
    );

    this._sendAutoStatsMessage(message);
    return stats;
  }

  handleAutoMessage(cleanMessage) {
    try {
      if (cleanMessage.trim() !== "The game starts in 10 seconds!") {
        return;
      }

      if (!this.api.config.get("autoQdmsg.enabled")) {
        return;
      }

      const validMessages = [];
      for (let i = 1; i <= 5; i++) {
        const msg = this.api.config.get(`autoQdmsg.msg${i}`);
        if (msg && msg.trim().length > 0) {
          validMessages.push(msg);
        }
      }

      if (validMessages.length === 0) {
        return;
      }

      let possibleMessages = [...validMessages];

      if (this.bwuInstance.lastQdmsg && validMessages.length > 1) {
        possibleMessages = validMessages.filter(
          (msg) => msg !== this.bwuInstance.lastQdmsg
        );
      }

      const randomMsg =
        possibleMessages[Math.floor(Math.random() * possibleMessages.length)];

      this.bwuInstance.lastQdmsg = randomMsg;

      this.api.sendChatToServer(`/ac ${randomMsg}`);
    } catch (e) {
      console.error(`[BWU] Error on handleAutoMessage: ${e.message}`);
    }
  }
}

module.exports = ChatHandler;
