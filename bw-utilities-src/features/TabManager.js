class TabManager {
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
   * Stop tab alternation and restore regular stats
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
   * Show game stats in tab for all managed players
   */
  _showGameStats() {
    for (const [playerName, data] of this.managedPlayers.entries()) {
      if (!data.uuid) continue;

      const gameStats = this._getGameStatsForEntry(playerName, data);
      const hasRenderableStats = this._hasNonZeroEnabledGameStats(gameStats);

      if (hasRenderableStats) {
        const gameStatsSuffix = this.statsFormatter.formatGameStatsForTab(gameStats);
        if (gameStatsSuffix) {
          this.api.setDisplayNameSuffix(data.uuid, gameStatsSuffix);
          continue;
        }
      }

      const cachedSuffix = this.cachedRegularStats.get(playerName);
      if (cachedSuffix) {
        this.api.setDisplayNameSuffix(data.uuid, cachedSuffix);
      }
    }
  }

  /**
   * Restore regular stats from cache
   */
  _restoreRegularStats() {
    for (const [playerName, data] of this.managedPlayers.entries()) {
      if (!data.uuid) continue;

      const cachedSuffix = this.cachedRegularStats.get(playerName);
      if (cachedSuffix) {
        this.api.setDisplayNameSuffix(data.uuid, cachedSuffix);
      }
    }
  }

  /**
   * Update game stats for a specific player (called when stats change)
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
        this.api.setDisplayNameSuffix(data.uuid, gameStatsSuffix);
      }
      return;
    }

    const cachedSuffix = this.cachedRegularStats.get(managedPlayerName);
    if (cachedSuffix) {
      this.api.setDisplayNameSuffix(data.uuid, cachedSuffix);
    }
  }

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
        this.api.setDisplayNameSuffix(player.uuid, statsSuffix);
      } else {
        const gameStats =
          this.bwu.inGameTracker.getPlayerStats(originalPlayerName) ||
          this.bwu.inGameTracker.getPlayerStats(finalNameForStats);
        if (this._hasNonZeroEnabledGameStats(gameStats)) {
          const gameStatsSuffix = this.statsFormatter.formatGameStatsForTab(gameStats);
          this.api.setDisplayNameSuffix(player.uuid, gameStatsSuffix || statsSuffix);
        } else {
          this.api.setDisplayNameSuffix(player.uuid, statsSuffix);
        }
      }

      this.managedPlayers.set(originalPlayerName, {
        type: "auto-stats",
        uuid: playerUuid,
        resolvedName: finalNameForStats,
      });
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
          this.api.setDisplayNameSuffix(playerUuid, fallbackSuffix);
        } else {
          const gameStats =
            this.bwu.inGameTracker.getPlayerStats(originalPlayerName) ||
            this.bwu.inGameTracker.getPlayerStats(resolvedName);
          if (this._hasNonZeroEnabledGameStats(gameStats)) {
            const gameStatsSuffix = this.statsFormatter.formatGameStatsForTab(gameStats);
            this.api.setDisplayNameSuffix(playerUuid, gameStatsSuffix || fallbackSuffix);
          } else {
            this.api.setDisplayNameSuffix(playerUuid, fallbackSuffix);
          }
        }

        this.managedPlayers.set(originalPlayerName, {
          type: "auto-stats",
          uuid: playerUuid,
          resolvedName: resolvedName,
        });
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
