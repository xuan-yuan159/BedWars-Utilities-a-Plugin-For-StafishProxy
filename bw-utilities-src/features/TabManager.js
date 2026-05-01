class TabManager {
  /**
   * 管理 Tab 战绩后缀与对局内轮播状态
   */
  constructor(api, apiService, statsFormatter, bwuInstance) {
    this.api = api;
    this.apiService = apiService;
    this.statsFormatter = statsFormatter;
    this.bwu = bwuInstance;
    this.managedPlayers = new Map();
    this.pendingPlayerRetries = new Map();
    this.maxPlayerRenderRetries = 4;
    this.playerRenderRetryDelayMs = 400;
    
    // Tab alternation state
    this.showingGameStats = false;
    this.tabAlternationInterval = null;
    this.cachedRegularStats = new Map(); // Store regular stats suffixes
    this.displayRefreshInterval = null; // 定时重挂后缀，避免名字颜色状态被旧渲染卡住
    this.displayRefreshIntervalMs = 1500; // 定时重挂后缀的间隔，覆盖玩家复活后的颜色恢复
  }

  /**
   * Start alternating between regular stats and game stats in tab
   */
  startTabAlternation() {
    if (this.tabAlternationInterval) {
      return; // Already running
    }

    if (!this.api.config.get("inGameTracker.showInTab")) {
      return; // Feature disabled
    }

    const delaySeconds = this.api.config.get("inGameTracker.tabDelay") || 5;
    const delayMs = delaySeconds * 1000;

    this.api.debugLog(`[BWU TabManager] Starting tab alternation with ${delaySeconds}s delay`);

    this.tabAlternationInterval = setInterval(() => {
      this._toggleTabStats();
    }, delayMs);
  }

  /**
   * 停止对局内轮播并恢复常规战绩显示
   */
  stopTabAlternation() {
    if (this.tabAlternationInterval) {
      clearInterval(this.tabAlternationInterval);
      this.tabAlternationInterval = null;
    }

    // Restore regular stats
    if (this.showingGameStats) {
      this.showingGameStats = false;
      this._restoreRegularStats();
    }

    this.stopDisplayRefreshLoop(); // 对局轮播结束后停止周期性重刷
    this.cachedRegularStats.clear();
    this.api.debugLog(`[BWU TabManager] Stopped tab alternation`);
  }

  /**
   * Toggle between regular stats and game stats display
   */
  _toggleTabStats() {
    if (!this.bwu.inGameTracker.isTracking) {
      return; // No game in progress
    }

    if (this.showingGameStats) {
      this.showingGameStats = false;
      this._restoreRegularStats();
      return;
    }

    if (!this._hasAnyRenderableGameStats()) {
      this._restoreRegularStats();
      return;
    }

    this.showingGameStats = true;
    this._showGameStats();
  }

  /**
   * 在 Tab 中显示对局内实时数据，并同步刷新名字颜色状态
   */
  _showGameStats() {
    for (const [playerName, data] of this.managedPlayers.entries()) {
      if (!data.uuid) continue;

      const gameStats = this._getGameStatsForEntry(playerName, data);
      const hasRenderableStats = this._hasNonZeroEnabledGameStats(gameStats);

      if (hasRenderableStats) {
        const gameStatsSuffix = this.statsFormatter.formatGameStatsForTab(gameStats);
        if (gameStatsSuffix) {
          this._applyDisplayNameSuffix(data.uuid, gameStatsSuffix); // 轮播到对局数据时强制重建显示名
          continue;
        }
      }

      const cachedSuffix = this.cachedRegularStats.get(playerName);
      if (cachedSuffix) {
        this._applyDisplayNameSuffix(data.uuid, cachedSuffix); // 无对局数据时回落常规后缀并刷新颜色
      }
    }
  }

  /**
   * 从缓存恢复常规战绩后缀，并同步刷新名字颜色状态
   */
  _restoreRegularStats() {
    for (const [playerName, data] of this.managedPlayers.entries()) {
      if (!data.uuid) continue;

      const cachedSuffix = this.cachedRegularStats.get(playerName);
      if (cachedSuffix) {
        this._applyDisplayNameSuffix(data.uuid, cachedSuffix); // 切回常规战绩时也重新挂载后缀
      }
    }
  }

  /**
   * 在对局数据变化时刷新单个玩家的 Tab 后缀
   */
  updatePlayerGameStats(playerName) {
    if (!this.showingGameStats) return;
    if (!this.api.config.get("inGameTracker.showInTab")) return;

    const managedEntry = this._findManagedPlayerEntry(playerName);
    if (!managedEntry?.data?.uuid) return;
    const { key: managedPlayerName, data } = managedEntry;

    const gameStats = this._getGameStatsForEntry(managedPlayerName, data);
    if (!gameStats) return;

    if (this._hasNonZeroEnabledGameStats(gameStats)) {
      const gameStatsSuffix = this.statsFormatter.formatGameStatsForTab(gameStats);
      if (gameStatsSuffix) {
        this._applyDisplayNameSuffix(data.uuid, gameStatsSuffix); // 重新挂载后缀，确保复活后的名字颜色被刷新
      }
      return;
    }

    const cachedSuffix = this.cachedRegularStats.get(managedPlayerName);
    if (cachedSuffix) {
      this._applyDisplayNameSuffix(data.uuid, cachedSuffix); // 回退到常规后缀时同步刷新名字颜色
    }
  }

  /**
   * 清理已管理的玩家并在必要时关闭重刷循环
   */
  clearManagedPlayers(type = "all") {
    for (const [name, data] of this.managedPlayers.entries()) {
      if (type === "all" || data.type === type) {
        if (data.uuid) {
          this.api.clearDisplayNameSuffix(data.uuid);
        }
        this.managedPlayers.delete(name);
        this.cachedRegularStats.delete(name);
        this._clearPendingRetry(name);
      }
    }

    if (type === "all") {
      for (const [pendingName, pending] of this.pendingPlayerRetries.entries()) {
        clearTimeout(pending.timeoutId);
        this.pendingPlayerRetries.delete(pendingName);
      }
    }

    if (this.managedPlayers.size === 0) {
      this.stopDisplayRefreshLoop(); // 没有受管玩家时停止定时刷新
    }
  }

  async addPlayersStatsToTabBatch(playerPairs, concurrency = 6) {
    if (!Array.isArray(playerPairs) || playerPairs.length === 0) {
      return;
    }

    const queue = playerPairs.filter((pair) => pair?.originalName);
    if (queue.length === 0) {
      return;
    }

    const workerCount = Math.max(1, Math.min(concurrency, queue.length));
    let cursor = 0;

    const worker = async () => {
      while (true) {
        const currentIndex = cursor++;
        if (currentIndex >= queue.length) {
          return;
        }

        const currentPair = queue[currentIndex];
        await this.addPlayerStatsToTab(
          currentPair.originalName,
          currentPair.resolvedName
        );
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  _clearPendingRetry(playerName) {
    const pending = this.pendingPlayerRetries.get(playerName);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.pendingPlayerRetries.delete(playerName);
  }

  _schedulePlayerRetry(originalPlayerName, resolvedPlayerName, nextAttempt, reason) {
    if (this.managedPlayers.has(originalPlayerName)) {
      this._clearPendingRetry(originalPlayerName);
      return;
    }

    if (nextAttempt > this.maxPlayerRenderRetries) {
      this._clearPendingRetry(originalPlayerName);
      this.api.debugLog(
        `[BWU TabManager] Retry limit reached for ${originalPlayerName} (${reason})`
      );
      return;
    }

    const pending = this.pendingPlayerRetries.get(originalPlayerName);
    if (pending) {
      if (pending.attempt >= nextAttempt) {
        pending.resolvedName = resolvedPlayerName;
        this.pendingPlayerRetries.set(originalPlayerName, pending);
        return;
      }
      clearTimeout(pending.timeoutId);
    }

    const timeoutId = setTimeout(() => {
      const latestPending = this.pendingPlayerRetries.get(originalPlayerName);
      if (!latestPending || latestPending.timeoutId !== timeoutId) {
        return;
      }

      this.pendingPlayerRetries.delete(originalPlayerName);
      void this.addPlayerStatsToTab(
        originalPlayerName,
        latestPending.resolvedName,
        nextAttempt
      );
    }, this.playerRenderRetryDelayMs);

    this.pendingPlayerRetries.set(originalPlayerName, {
      timeoutId,
      attempt: nextAttempt,
      resolvedName: resolvedPlayerName,
    });
  }

  /**
   * 持续重挂 Tab 后缀，保证服务端更新名字颜色后客户端也能同步显示
   */
  startDisplayRefreshLoop() {
    if (this.displayRefreshInterval) {
      return;
    }

    this.displayRefreshInterval = setInterval(() => {
      this.refreshManagedPlayerDisplayNames();
    }, this.displayRefreshIntervalMs);
  }

  /**
   * 停止周期性重挂 Tab 后缀
   */
  stopDisplayRefreshLoop() {
    if (!this.displayRefreshInterval) {
      return;
    }

    clearInterval(this.displayRefreshInterval);
    this.displayRefreshInterval = null;
  }

  /**
   * 重新为所有已管理玩家挂载当前应显示的 Tab 后缀
   */
  refreshManagedPlayerDisplayNames() {
    if (this.managedPlayers.size === 0) {
      this.stopDisplayRefreshLoop(); // 空列表时自动关闭循环
      return;
    }

    for (const [playerName, data] of this.managedPlayers.entries()) {
      if (!data?.uuid) continue;

      const suffix = this._resolveDisplaySuffixForManagedPlayer(playerName, data);
      if (!suffix) continue;

      this._applyDisplayNameSuffix(data.uuid, suffix); // 先清再挂，强制刷新名字颜色状态
    }
  }

  /**
   * 根据当前轮播状态计算玩家应该显示的后缀内容
   */
  _resolveDisplaySuffixForManagedPlayer(playerName, data) {
    if (this.showingGameStats) {
      const gameStats = this._getGameStatsForEntry(playerName, data);
      if (this._hasNonZeroEnabledGameStats(gameStats)) {
        const gameStatsSuffix =
          this.statsFormatter.formatGameStatsForTab(gameStats);
        if (gameStatsSuffix) {
          return gameStatsSuffix;
        }
      }
    }

    return this.cachedRegularStats.get(playerName) || "";
  }

  /**
   * 通过先清理再设置的方式重建显示名，避免灰名状态残留
   */
  _applyDisplayNameSuffix(playerUuid, suffix) {
    if (!playerUuid) {
      return;
    }

    if (!suffix) {
      this.api.clearDisplayNameSuffix(playerUuid); // 没有后缀时直接清理显示名后缀
      return;
    }

    this.api.clearDisplayNameSuffix(playerUuid); // 先移除旧后缀，避免沿用死亡时的灰名缓存
    this.api.setDisplayNameSuffix(playerUuid, suffix); // 重新挂载最新后缀，触发名字颜色重新计算
  }

  /**
   * 为单个玩家查询战绩并挂载 Tab 后缀
   */
  async addPlayerStatsToTab(originalPlayerName, resolvedPlayerName, attempt = 0) {
    const resolvedName = resolvedPlayerName || originalPlayerName;
    let playerUuid = null;

    try {
      const existingManaged = this.managedPlayers.get(originalPlayerName);
      if (existingManaged) {
        existingManaged.resolvedName = resolvedName;
        this._clearPendingRetry(originalPlayerName);
        return;
      }

      let player = null;
      const me = this.api.getCurrentPlayer();
      const myRealName = me ? me.name : null;

      if (
        myRealName &&
        resolvedName.toLowerCase() === myRealName.toLowerCase()
      ) {
        player = me;
        const playerByNick = this.api.getPlayerByName(originalPlayerName);
        if (playerByNick) {
          player.uuid = playerByNick.uuid;
        }
      } else {
        player = this.api.getPlayerByName(originalPlayerName);
        if (
          !player?.uuid &&
          resolvedName &&
          resolvedName.toLowerCase() !== originalPlayerName.toLowerCase()
        ) {
          player = this.api.getPlayerByName(resolvedName);
        }
      }

      if (!player?.uuid) {
        this._schedulePlayerRetry(
          originalPlayerName,
          resolvedName,
          attempt + 1,
          "player uuid unavailable"
        );
        return;
      }
      playerUuid = player.uuid;
      this._clearPendingRetry(originalPlayerName);
      if (this.managedPlayers.has(originalPlayerName)) return;

      const finalNameForStats = resolvedName;
      const promises = [this.apiService.getPlayerStats(finalNameForStats)];

      if (this.api.config.get("stats.showPing.enabled")) {
        const pingPromise = (async () => {
          const realUuid = await this.apiService.getUuid(finalNameForStats);
          if (realUuid) {
            return this.apiService.getPlayerPing(realUuid);
          }
          return null;
        })();
        promises.push(pingPromise);
      } else {
        promises.push(Promise.resolve(null));
      }

      const [stats, ping] = await Promise.all(promises);

      const statsSuffix = this.statsFormatter.formatStats(
        "tab",
        finalNameForStats,
        stats,
        ping
      );

      // Cache the regular stats suffix for alternation
      this.cachedRegularStats.set(originalPlayerName, statsSuffix);

      // Only set regular stats if not currently showing game stats
      if (!this.showingGameStats) {
        this._applyDisplayNameSuffix(player.uuid, statsSuffix); // 首次渲染时也走重建逻辑，避免锁住旧名字颜色
      } else {
        const gameStats =
          this.bwu.inGameTracker.getPlayerStats(originalPlayerName) ||
          this.bwu.inGameTracker.getPlayerStats(finalNameForStats);
        if (this._hasNonZeroEnabledGameStats(gameStats)) {
          const gameStatsSuffix = this.statsFormatter.formatGameStatsForTab(gameStats);
          this._applyDisplayNameSuffix(player.uuid, gameStatsSuffix || statsSuffix); // 对局后缀优先，同时强制刷新名字颜色
        } else {
          this._applyDisplayNameSuffix(player.uuid, statsSuffix); // 无对局数据时回落常规后缀
        }
      }

      this.managedPlayers.set(originalPlayerName, {
        type: "auto-stats",
        uuid: playerUuid,
        resolvedName: finalNameForStats,
      });
      this.startDisplayRefreshLoop(); // 开始周期性重刷，覆盖玩家死亡/复活后的颜色切换
    } catch (error) {
      console.error(
        `[BWU] Failed to add stats to tab for ${originalPlayerName}: ${error.stack}`
      );

      if (this.managedPlayers.has(originalPlayerName)) {
        return;
      }

      if (attempt < this.maxPlayerRenderRetries) {
        this._schedulePlayerRetry(
          originalPlayerName,
          resolvedName,
          attempt + 1,
          "tab render exception"
        );
        return;
      }

      if (playerUuid) {
        const fallbackSuffix = this.statsFormatter.formatStats(
          "tab",
          resolvedName,
          null,
          null
        );

        this.cachedRegularStats.set(originalPlayerName, fallbackSuffix);
        if (!this.showingGameStats) {
          this._applyDisplayNameSuffix(playerUuid, fallbackSuffix); // 降级渲染时也保持颜色刷新逻辑一致
        } else {
          const gameStats =
            this.bwu.inGameTracker.getPlayerStats(originalPlayerName) ||
            this.bwu.inGameTracker.getPlayerStats(resolvedName);
          if (this._hasNonZeroEnabledGameStats(gameStats)) {
            const gameStatsSuffix = this.statsFormatter.formatGameStatsForTab(gameStats);
            this._applyDisplayNameSuffix(playerUuid, gameStatsSuffix || fallbackSuffix); // 对局降级状态也统一走重建逻辑
          } else {
            this._applyDisplayNameSuffix(playerUuid, fallbackSuffix); // 无对局数据时继续显示降级后缀
          }
        }

        this.managedPlayers.set(originalPlayerName, {
          type: "auto-stats",
          uuid: playerUuid,
          resolvedName: resolvedName,
        });
        this.startDisplayRefreshLoop(); // 降级渲染成功后同样开启周期性刷新
      }
    }
  }

  _findManagedPlayerEntry(playerName) {
    if (!playerName || typeof playerName !== "string") {
      return null;
    }

    const directEntry = this.managedPlayers.get(playerName);
    if (directEntry) {
      return { key: playerName, data: directEntry };
    }

    const lowerName = playerName.toLowerCase();
    for (const [managedName, data] of this.managedPlayers.entries()) {
      if (managedName.toLowerCase() === lowerName) {
        return { key: managedName, data };
      }

      if (
        typeof data.resolvedName === "string" &&
        data.resolvedName.toLowerCase() === lowerName
      ) {
        return { key: managedName, data };
      }
    }

    return null;
  }

  _getGameStatsForEntry(managedName, data) {
    const byOriginal = this.bwu.inGameTracker.getPlayerStats(managedName);
    if (byOriginal) {
      return byOriginal;
    }

    if (data?.resolvedName) {
      return this.bwu.inGameTracker.getPlayerStats(data.resolvedName);
    }

    return null;
  }

  _hasAnyRenderableGameStats() {
    for (const [managedName, data] of this.managedPlayers.entries()) {
      const gameStats = this._getGameStatsForEntry(managedName, data);
      if (this._hasNonZeroEnabledGameStats(gameStats)) {
        return true;
      }
    }
    return false;
  }

  _hasNonZeroEnabledGameStats(gameStats) {
    if (!gameStats) {
      return false;
    }

    const config = this.api.config;
    if (config.get("inGameTracker.tabShowKills") && Number(gameStats.kills) > 0) {
      return true;
    }
    if (config.get("inGameTracker.tabShowDeaths") && Number(gameStats.deaths) > 0) {
      return true;
    }
    if (
      config.get("inGameTracker.tabShowFinalKills") &&
      Number(gameStats.finalKills) > 0
    ) {
      return true;
    }
    if (
      config.get("inGameTracker.tabShowBedBreaks") &&
      Number(gameStats.bedsBroken) > 0
    ) {
      return true;
    }

    return false;
  }
}

module.exports = TabManager;
