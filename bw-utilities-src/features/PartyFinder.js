const MAX_STATS_RETRIES = 3; // 玩家战绩查询失败后的最大额外重试次数
const STATS_RETRY_DELAY = 300; // 两次战绩查询之间的等待时间，降低瞬时请求失败概率

class PartyFinder {
  /**
   * 初始化队伍招募服务及固定附加信息。
   */
  constructor(api, apiService) {
    this.api = api;
    this.apiService = apiService;
    this.messageSuffixes = [
      "aaa",
      "bbbb",
      "ccccc",
      "qweqwe",
      "<3<3<3",
      "Ciallo~~",
      "(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧",
    ];
    this.resetState();
  }

  resetState() {
    this.isActive = false;
    this.state = null;
    clearTimeout(this.messageLoopTimeout);
  }

  /**
   * 启动自动组队招募并初始化筛选条件。
   */
  start(args) {
    if (this.isActive) {
      this.api.chat(
        `${this.api.getPrefix()} §cParty finder is already active. Use /bwu find stop.`
      );
      return;
    }

    const [mode, playersToFind, fkdrThreshold, starsThreshold, ...positions] = args;
    const fkdrThresholdNum = Number.parseFloat(fkdrThreshold);
    const starsThresholdNum = Number(starsThreshold);

    if (
      !["2", "3", "4"].includes(mode) ||
      !["1", "2", "3"].includes(playersToFind) ||
      !Number.isFinite(fkdrThresholdNum) ||
      !Number.isInteger(starsThresholdNum) ||
      starsThresholdNum < 0
    ) {
      this.api.chat(
        `${this.api.getPrefix()} §cInvalid arguments. Usage: /bwu find <mode> <people> <fkdr> <stars> <role1> <role2>...`
      );
      return;
    }

    const playersToFindNum = Number.parseInt(playersToFind);
    const modeNum = Number.parseInt(mode);

    if (playersToFindNum >= modeNum) {
      this.api.chat(
        `${this.api.getPrefix()} §cError: The number of players to find (${playersToFindNum})§c must be less §cthan the mode size (${modeNum})§c.`
      );
      return;
    }

    const fixedPosition = positions.join(" ").trim() || "any"; // 将所有附加信息合并为一条固定文本
    const initialVacancies = [];
    for (let i = 0; i < playersToFindNum; i++) {
      initialVacancies.push(fixedPosition);
    }

    this.state = {
      mode: Number.parseInt(mode),
      playersToFind: playersToFindNum,
      fkdrThreshold: fkdrThresholdNum,
      starsThreshold: starsThresholdNum, // 保存最低 BedWars 星数阈值
      vacancies: initialVacancies,
      foundPlayers: [],
      myNick: null,
      currentSuffixIndex: -1,
      isProcessing: false,
    };

    this.isActive = true;
    this.api.chat(`${this.api.getPrefix()} §aStarting party finder...`);
    this.executeNextStep();
  }

  stop() {
    if (!this.isActive) {
      this.api.chat(`${this.api.getPrefix()} §cParty finder is not active.`);
      return;
    }
    this.resetState();
    this.api.chat(`${this.api.getPrefix()} §cParty finder stopped.`);
  }

  /**
   * 进入下一轮招募流程并直接开始发送招募消息。
   */
  executeNextStep() {
    if (!this.isActive) return;

    if (this.state.vacancies.length === 0) {
      this.api.chat(
        `${this.api.getPrefix()} §aFinished finding all players! Party is full.`
      );
      this.resetState();
      return;
    }

    const me = this.api.getCurrentPlayer();
    if (!me?.uuid) return this.stop();
    this.state.myNick = this.api.getPlayerInfo(me.uuid)?.name || me.name;

    this.state.isProcessing = false;
    this.startMessageLoop();
  }

  /**
   * 按固定的十五秒间隔发送当前空缺位置的招募消息。
   */
  startMessageLoop() {
    if (!this.isActive || this.state.isProcessing) return;

    this.state.currentSuffixIndex =
      (this.state.currentSuffixIndex + 1) % this.messageSuffixes.length;

    const suffix = this.messageSuffixes[this.state.currentSuffixIndex];
    const currentPartySize = this.state.mode - this.state.vacancies.length;
    const position = this.state.vacancies[0];
    const message = `/ac ${currentPartySize}/${this.state.mode} ${position} ${suffix}`;

    this.api.chat(
      `${this.api.getPrefix()} §eLooking for player ${
        this.state.foundPlayers.length + 1
      }/${this.state.playersToFind} (Role: ${position}). Sending: ${message}`
    );
    this.api.sendChatToServer(message);

    const nextDelay = 15000; // 统一设置为十五秒发送一次

    this.messageLoopTimeout = setTimeout(
      () => this.startMessageLoop(),
      nextDelay
    );
  }

  async handleChatMessage(cleanMessage) {
    if (!this.isActive || !this.state) return;

    if (this.state.foundPlayers.length > 0) {
      if (this._handlePartyLeave(cleanMessage)) {
        return;
      }
    }

    if (this.state.isProcessing && this.state.waitingForPlayer) {
      if (this._handleInviteResponse(cleanMessage)) {
        return;
      }
    }

    if (!this.state.isProcessing) {
      this._handleMention(cleanMessage);
    }
  }

  _handlePartyLeave(cleanMessage) {
    const leaveRegex = /^(\[.*?\]\s)?(\w{3,16}) has left the party\.$/i;
    const leaveMatch = cleanMessage.match(leaveRegex);

    if (leaveMatch) {
      const playerNameWhoLeft = leaveMatch[2];
      const playerIndex = this.state.foundPlayers.findIndex(
        (p) => p.name.toLowerCase() === playerNameWhoLeft.toLowerCase()
      );

      if (playerIndex > -1) {
        clearTimeout(this.messageLoopTimeout);
        const playerInfo = this.state.foundPlayers[playerIndex];
        this.api.chat(
          `${this.api.getPrefix()} §c${
            playerInfo.name
          } left. Finding replacement for: ${playerInfo.position}...`
        );

        this.state.foundPlayers.splice(playerIndex, 1);
        this.state.vacancies.unshift(playerInfo.position);

        this.executeNextStep();
        return true;
      }
    }
    return false;
  }

  /**
   * 查询候选玩家战绩，失败后最多额外重试三次。
   */
  async getPlayerStatsWithRetry(playerName, currentState) {
    for (let retryCount = 0; retryCount <= MAX_STATS_RETRIES; retryCount++) {
      if (!this.isActive || this.state !== currentState) {
        return null; // 自动查找已停止或状态已切换时取消剩余查询
      }

      let stats = null;
      try {
        stats = await this.apiService.getPlayerStats(playerName);
      } catch (error) {
        this.api.debugLog(
          `[BWU] Failed to fetch stats for ${playerName}: ${error.message}`
        );
      }

      if (stats?.isNicked) {
        return stats; // 已明确判定为 Nick 时无需重复请求
      }

      const hasValidStats =
        stats &&
        Number.isFinite(stats.fkdr) &&
        Number.isFinite(stats.stars);

      if (hasValidStats) {
        return stats;
      }

      if (retryCount < MAX_STATS_RETRIES) {
        this.api.debugLog(
          `[BWU] Retrying stats for ${playerName} (${retryCount + 1}/${MAX_STATS_RETRIES})`
        );
        await this.sleep(STATS_RETRY_DELAY);
      }
    }

    this.api.debugLog(
      `[BWU] Stats lookup failed after ${MAX_STATS_RETRIES} retries: ${playerName}`
    );
    return null;
  }

  _handleInviteResponse(cleanMessage) {
    const waitingFor = this.state.waitingForPlayer;
    const joinRegex = new RegExp(
      `^(\\[.*?\\]\\s)?${waitingFor} joined the party\\.$`,
      "i"
    );
    const expireRegex = new RegExp(
      `^The party invite to .*${waitingFor} has expired.*$`,
      "i"
    );

    if (joinRegex.test(cleanMessage)) {
      this.api.chat(`${this.api.getPrefix()} §a${waitingFor} joined!`);

      const filledPosition = this.state.vacancies.shift();
      this.state.foundPlayers.push({
        name: waitingFor,
        position: filledPosition,
      });

      this.sleep(1500).then(() => this.executeNextStep());
      return true;
    } else if (expireRegex.test(cleanMessage)) {
      this.api.chat(
        `${this.api.getPrefix()} §cInvite expired. Resuming search...`
      );
      this.sleep(1500).then(() => this.executeNextStep());
      return true;
    }
    return false;
  }

  /**
   * 处理聊天中的昵称提及，并按 FKDR 与星数筛选候选人。
   */
  async _handleMention(cleanMessage) {
    const chatRegex = /^(?:\[.*?\]\s*)*(\w{3,16})(?::| ») (.*)/;
    const match = cleanMessage.match(chatRegex);

    if (match) {
      const senderName = match[1];
      const messageContent = match[2];
      const alreadyFound = this.state.foundPlayers.some(
        (p) => p.name.toLowerCase() === senderName.toLowerCase()
      );

      if (
        messageContent
          .toLowerCase()
          .includes(this.state.myNick.toLowerCase()) &&
        !alreadyFound
      ) {
        this.state.isProcessing = true;
        clearTimeout(this.messageLoopTimeout);
        const currentState = this.state; // 固定本次候选处理对应的查找状态

        this.api.chat(
          `${this.api.getPrefix()} §aMention by ${senderName}. Checking stats...`
        );
        const stats = await this.getPlayerStatsWithRetry(
          senderName,
          currentState
        );
        if (!this.isActive || this.state !== currentState) {
          return; // 停止或切换查找后不再处理旧查询结果
        }
        const hasValidStats =
          stats &&
          Number.isFinite(stats.fkdr) &&
          Number.isFinite(stats.stars);

        if (
          hasValidStats &&
          stats.fkdr >= this.state.fkdrThreshold &&
          stats.stars >= this.state.starsThreshold
        ) {
          this.state.waitingForPlayer = senderName;
          this.api.chat(
            `${this.api.getPrefix()} §a${senderName} has ${stats.fkdr.toFixed(
              2
            )} FKDR and ${stats.stars} stars. Inviting...`
          );
          this.api.sendChatToServer(`/p invite ${senderName}`);
        } else {
          const reasons = [];
          if (!hasValidStats) {
            reasons.push("Stats not found");
          } else {
            if (stats.fkdr < this.state.fkdrThreshold) {
              reasons.push(`FKDR too low (${stats.fkdr.toFixed(2)})`);
            }
            if (stats.stars < this.state.starsThreshold) {
              reasons.push(`Stars too low (${stats.stars})`);
            }
          }
          const reason = reasons.join(", ");
          this.api.chat(
            `${this.api.getPrefix()} §cSkipping ${senderName}: ${reason}.`
          );
          this.state.isProcessing = false;
          this.startMessageLoop();
        }
      }
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = PartyFinder;
