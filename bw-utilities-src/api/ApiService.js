const NETHER_API_BASE_URL = "https://netherapi.com/api"; // NetherApi API 基础地址
const URCHIN_API_BASE_URL = "https://api.urchin.gg"; // Urchin API 基础地址

class ApiService {
  constructor(api, cacheManager) {
    this.api = api;
    this.cache = cacheManager;
  }

  _isTimeoutError(error) {
    return error?.name === "AbortError";
  }

  async _fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * 测试 NetherApi API Key 是否有效
   */
  async testNetherApiKey() {
    try {
      const apiKey = this.api.config.get("main.netherApiKey"); // 读取 NetherApi API Key
      if (!apiKey || apiKey === "YOUR_NETHER_API_KEY_HERE") {
        return { isValid: false, reason: "API key not set." };
      }

      const response = await this._fetchWithTimeout(
        `${NETHER_API_BASE_URL}/v2/counts`, // 使用 NetherApi 的 Key 校验接口
        {
          headers: { "API-Key": apiKey }, // 按 NetherApi 官方示例传递 API Key
        },
        3000
      );

      const data = await response.json();

      if (data.success) {
        return { isValid: true };
      } else {
        return { isValid: false, reason: data.cause || "Invalid API key." };
      }
    } catch (error) {
      console.error(`[BWU NETHER API] API key test failed: ${error.message}`);
      return { isValid: false, reason: "Failed to connect to NetherApi." };
    }
  }

  async getUuid(playerName) {
    // try to get uuid from starfish first
    const playerFromProxy = this.api.getPlayerByName(playerName);
    if (playerFromProxy?.uuid) {
      return playerFromProxy.uuid;
    }

    // try to use cache to get uuid if starfish fails
    const cached = this.cache.getUuid(playerName);
    if (cached) return cached;

    // use mojang api to get uuid if starfish and cache fails
    try {
      const response = await this._fetchWithTimeout(
        `https://api.mojang.com/users/profiles/minecraft/${playerName}`,
        {},
        2500
      );
      if (!response.ok) return null;

      const data = await response.json();
      this.cache.setUuid(playerName, data.id);
      return data.id;
    } catch (error) {
      const reason = this._isTimeoutError(error)
        ? "request timed out"
        : error.message;
      console.error(
        `[BWU MOJANG API] Failed to fetch UUID for ${playerName}: ${reason}`
      );
      return null;
    }
  }

  _getRankDisplay(player) {
    const colorMap = {
      BLACK: "§0",
      DARK_BLUE: "§1",
      DARK_GREEN: "§2",
      DARK_AQUA: "§3",
      DARK_RED: "§4",
      DARK_PURPLE: "§5",
      GOLD: "§6",
      GRAY: "§7",
      DARK_GRAY: "§8",
      BLUE: "§9",
      GREEN: "§a",
      AQUA: "§b",
      RED: "§c",
      LIGHT_PURPLE: "§d",
      YELLOW: "§e",
      WHITE: "§f",
    };

    let plusColor = "§c";
    if (player.rankPlusColor && colorMap[player.rankPlusColor]) {
      plusColor = colorMap[player.rankPlusColor];
    }

    // Need to check this shit ai made this bitch ass code
    if (player.rank && player.rank !== "NORMAL") {
      const r = player.rank;
      if (r === "YOUTUBER") return "§c[§fYOUTUBE§c]";
      if (r === "GAME_MASTER") return "§2[GM]";
      if (r === "ADMIN") return "§c[ADMIN]";
      if (r === "MODERATOR") return "§2[MOD]";
      if (r === "HELPER") return "§9[HELPER]";
      if (r === "MAYOR") return "§d[MAYOR]";
    }

    if (player.monthlyPackageRank === "SUPERSTAR") {
      let rankColor = "§6";
      if (player.monthlyRankColor === "AQUA") rankColor = "§b";
      return `${rankColor}[MVP${plusColor}++${rankColor}]`;
    }

    if (player.newPackageRank === "MVP_PLUS") {
      return `§b[MVP${plusColor}+§b]`;
    }

    if (player.newPackageRank === "MVP") {
      return "§b[MVP]";
    }

    if (player.newPackageRank === "VIP_PLUS") {
      return "§a[VIP§6+§a]";
    }

    if (player.newPackageRank === "VIP") {
      return "§a[VIP]";
    }

    return "§7";
  }

  /**
   * 通过 NetherApi 获取玩家 BedWars 战绩
   */
  async getPlayerStats(playerName) {
    const cached = this.cache.getPlayerStats(playerName);
    if (cached) return cached;

    try {
      const apiKey = this.api.config.get("main.netherApiKey"); // 读取 NetherApi API Key
      if (!apiKey || apiKey === "YOUR_NETHER_API_KEY_HERE") return null;

      const uuid = await this.getUuid(playerName);
      if (!uuid) return { isNicked: true };

      const response = await this._fetchWithTimeout(
        `${NETHER_API_BASE_URL}/v2/player?uuid=${uuid}`, // 请求 NetherApi 玩家数据
        { headers: { "API-Key": apiKey } }, // 按官方示例传递 API Key
        3000
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (!data.success || !data.player) return { isNicked: true };

      const rankDisplay = this._getRankDisplay(data.player);

      const stats = data.player.stats?.Bedwars || {};
      const finalKills = stats.final_kills_bedwars || 0;
      const finalDeaths = stats.final_deaths_bedwars || 0;
      const wins = stats.wins_bedwars || 0;
      const losses = stats.losses_bedwars || 0;

      const relevantStats = {
        rank: rankDisplay,
        isNicked: false,
        stars: data.player.achievements?.bedwars_level || 0,
        fkdr: finalKills / Math.max(1, finalDeaths),
        final_kills: finalKills,
        final_deaths: finalDeaths,
        beds_broken: stats.beds_broken_bedwars || 0,
        winstreak: stats.winstreak || 0,
        wins: wins,
        losses: losses,
        wlr: wins / Math.max(1, losses),
      };

      this.cache.setPlayerStats(playerName, relevantStats);
      return relevantStats;
    } catch (error) {
      const reason = this._isTimeoutError(error)
        ? "request timed out"
        : error.message;
      console.error(
        `[BWU NETHER API] Failed to fetch player stats for ${playerName}: ${reason}`
      );
      return null;
    }
  }

  /**
   * 通过 Urchin API 查询玩家标签，未配置 Key 或请求失败时静默返回空结果。
   * @param {string} playerName 玩家名称
   * @returns {Promise<Array<object> | null>} 标签列表；无法查询时返回 null
   */
  async getPlayerTags(playerName) {
    const apiKey = this.api.config.get("main.urchinApiKey"); // 读取独立的 Urchin API Key
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
      return null; // 未配置 Key 时不影响原有自动战绩流程
    }

    try {
      const response = await this._fetchWithTimeout(
        `${URCHIN_API_BASE_URL}/v3/player/tags?player=${encodeURIComponent(
          playerName
        )}`,
        {
          headers: { "X-API-Key": apiKey.trim() }, // 按 Urchin v3 接口要求传递鉴权头
        },
        3000
      );

      if (response.status === 404) {
        return []; // 未找到玩家或标签时按无标签处理
      }

      if (!response.ok) {
        console.error(
          `[BWU URCHIN API] Failed to fetch tags for ${playerName}: HTTP ${response.status}`
        );
        return null;
      }

      const data = await response.json();
      return Array.isArray(data?.tags) ? data.tags : [];
    } catch (error) {
      const reason = this._isTimeoutError(error)
        ? "request timed out"
        : error.message;
      console.error(
        `[BWU URCHIN API] Failed to fetch tags for ${playerName}: ${reason}`
      );
      return null;
    }
  }

  async getPlayerPing(uuid) {
    const cached = this.cache.getPing(uuid);
    if (cached !== null) return cached;

    try {
      const apiKey = this.api.config.get("main.auroraApiKey");
      if (!apiKey || apiKey === "YOUR_AURORA_API_KEY_HERE") return null;

      const response = await this._fetchWithTimeout(
        `https://bordic.xyz/api/v2/resources/ping?key=${apiKey}&uuid=${uuid}`,
        {},
        2500
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (!data.success || !Array.isArray(data.data) || data.data.length === 0)
        return null;

      const avgPing = Math.round(data.data[0].avg);
      this.cache.setPing(uuid, avgPing);
      return avgPing;
    } catch (error) {
      const reason = this._isTimeoutError(error)
        ? "request timed out"
        : error.message;
      console.error(
        `[BWU AURORA API] Failed to fetch ping for ${uuid}: ${reason}`
      );
      return null;
    }
  }

  async getNameHistory(playerName) {
    try {
      const response = await fetch(
        `https://laby.net/api/v3/search/profiles/${playerName}`
      );

      if (!response.ok) return null;

      const data = await response.json();
      if (
        !data.users ||
        !Array.isArray(data.users) ||
        data.users.length === 0
      ) {
        return null;
      }

      const user = data.users[0];
      if (!user.history || !Array.isArray(user.history)) {
        return null;
      }

      return {
        currentName: user.name,
        uuid: user.uuid,
        history: user.history.map((entry) => ({
          name: entry.name,
          changedAt: entry.changed_at,
          accurate: entry.accurate,
          lastSeenAt: entry.last_seen_at,
        })),
      };
    } catch (error) {
      console.error(
        `[BWU LABY API] Failed to fetch name history for ${playerName}: ${error.message}`
      );
      return null;
    }
  }
}

module.exports = ApiService;
