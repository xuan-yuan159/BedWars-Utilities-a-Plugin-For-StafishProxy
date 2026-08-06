class CommandRegistry {
  /**
   * 注册 BWU 命令及其参数。
   */
  static register(api, commandHandler) {
    const t = (key, fallback) =>
      typeof api.t === "function" ? api.t(key, null, fallback) : fallback;

    api.commands((registry) => {
      registry
        .command("find")
        .description(
          t(
            "command.find.description",
            "Finds players for your party based on criteria."
          )
        )
        .argument("<mode>", {
          description: t(
            "command.find.arg_mode",
            "Mode (2, 3, 4) or 'stop'"
          ),
        })
        .argument("[playersToFind]", {
          description: t(
            "command.find.arg_players_to_find",
            "Number of players to find"
          ),
          optional: true,
        })
        .argument("[fkdrThreshold]", {
          description: t(
            "command.find.arg_fkdr_threshold",
            "Minimum FKDR required"
          ),
          optional: true,
        })
        .argument("[starsThreshold]", { // 新增最低星数参数，保留 stop 命令的可用性
          description: t(
            "command.find.arg_stars_threshold",
            "Minimum BedWars stars required"
          ),
          optional: true,
        })
        .argument("positions", {
          description: t(
            "command.find.arg_positions",
            "Optional fixed recruitment info"
          ),
          optional: true,
          type: "greedy",
        })
        .handler((ctx) => commandHandler.handleFindCommand(ctx));

      registry
        .command("ping")
        .description(
          t("command.ping.description", "Shows your current ping to the server.")
        )
        .handler((ctx) => commandHandler.handlePingCommand(ctx));

      registry
        .command("stats")
        .description(
          t(
            "command.stats.description",
            "Shows the Bedwars statistics for a player."
          )
        )
        .argument("<nickname>", {
          description: t("command.stats.arg_nickname", "The player to check"),
        })
        .handler((ctx) => commandHandler.handleStatsCommand(ctx));

      registry
        .command("setthreshold")
        .description(
          t(
            "command.setthreshold.description",
            "Sets the FKDR threshold for auto-requeue."
          )
        )
        .argument("<threshold>", {
          description: t(
            "command.setthreshold.arg_threshold",
            "The FKDR value (e.g., 10.0)"
          ),
        })
        .handler((ctx) => commandHandler.handleSetThresholdCommand(ctx));

      registry
        .command("clearstats")
        .description(
          t("command.clearstats.description", "Clears stats of players.")
        )
        .handler((ctx) => commandHandler.handleClearCommand(ctx));

      registry
        .command("setkey")
        .description(t("command.setkey.description", "Set your NetherApi API key"))
        .argument("<apikey>", {
          description: t("command.setkey.arg_apikey", "Your NetherApi API key"),
        })
        .handler((ctx) => commandHandler.handleSetKeyCommand(ctx));

      registry
        .command("setaurora")
        .description(t("command.setaurora.description", "Set your Aurora API key"))
        .argument("<apikey>", {
          description: t("command.setaurora.arg_apikey", "Your Aurora API key"),
        })
        .handler((ctx) => commandHandler.handleSetAuroraCommand(ctx));

      // 注册 Urchin API Key 配置命令
      registry
        .command("seturchin")
        .description(t("command.seturchin.description", "Set your Urchin API key"))
        .argument("<apikey>", {
          description: t("command.seturchin.arg_apikey", "Your Urchin API key"),
        })
        .handler((ctx) => commandHandler.handleSetUrchinCommand(ctx));

      registry
        .command("setqdmsg")
        .description(
          t(
            "command.setqdmsg.description",
            "Sets a queue dodge message for a slot (1-5)."
          )
        )
        .argument("<slot>", {
          description: t("command.setqdmsg.arg_slot", "Slot number (1-5)"),
        })
        .argument("message", {
          description: t("command.setqdmsg.arg_message", "The message to save"),
          optional: true,
          type: "greedy",
        })
        .handler((ctx) => commandHandler.handleSetQdmsgCommand(ctx));

      registry
        .command("listqdmsg")
        .description(
          t(
            "command.listqdmsg.description",
            "Lists all saved queue dodge messages."
          )
        )
        .handler((ctx) => commandHandler.handleListQdmsgCommand(ctx));

      registry
        .command("qdmsg")
        .description(
          t(
            "command.qdmsg.description",
            "Sends a saved queue dodge message manually."
          )
        )
        .argument("<slot>", {
          description: t("command.qdmsg.arg_slot", "Slot number (1-5)"),
        })
        .handler((ctx) => commandHandler.handleQdmsgCommand(ctx));

      registry
        .command("setsniped")
        .description(
          t(
            "command.setsniped.description",
            "Sets a sniped message for a slot (1-5)."
          )
        )
        .argument("<slot>", {
          description: t("command.setsniped.arg_slot", "Slot number (1-5)"),
        })
        .argument("message", {
          description: t("command.setsniped.arg_message", "The message to save"),
          optional: true,
          type: "greedy",
        })
        .handler((ctx) => commandHandler.handleSetSnipedCommand(ctx));

      registry
        .command("listsniped")
        .description(
          t("command.listsniped.description", "Lists all saved sniped messages.")
        )
        .handler((ctx) => commandHandler.handleListSnipedCommand(ctx));

      registry
        .command("sniped")
        .description(
          t("command.sniped.description", "Sends a saved sniped message.")
        )
        .argument("<slot>", {
          description: t("command.sniped.arg_slot", "Slot number (1-5)"),
        })
        .argument("[channel]", {
          description: t(
            "command.sniped.arg_channel",
            "Chat channel ('ac' for all chat, default is /shout)"
          ),
          optional: true,
        })
        .handler((ctx) => commandHandler.handleSnipedCommand(ctx));

      registry
        .command("setmacro")
        .description(
          t("command.setmacro.description", "Saves or updates a chat macro.")
        )
        .argument("<name>", {
          description: t(
            "command.setmacro.arg_name",
            "The name used to call the macro."
          ),
        })
        .argument("content", {
          description: t(
            "command.setmacro.arg_content",
            "The command or message to be saved."
          ),
          type: "greedy",
        })
        .handler((ctx) => commandHandler.handleSetMacroCommand(ctx));

      registry
        .command("delmacro")
        .description(t("command.delmacro.description", "Removes a macro."))
        .argument("<name>", {
          description: t(
            "command.delmacro.arg_name",
            "The name of the macro to be removed."
          ),
        })
        .handler((ctx) => commandHandler.handleDelMacroCommand(ctx));

      registry
        .command("macros")
        .description(t("command.macros.description", "Lists all saved macros."))
        .handler((ctx) => commandHandler.handleListMacrosCommand(ctx));

      registry
        .command("m")
        .description(t("command.m.description", "Executes a saved macro."))
        .argument("<name>", {
          description: t(
            "command.m.arg_name",
            "The name of the macro to execute."
          ),
        })
        .handler((ctx) => commandHandler.handleRunMacroCommand(ctx));

      registry
        .command("mcnames")
        .description(
          t(
            "command.mcnames.description",
            "Shows the name history of a Minecraft player."
          )
        )
        .argument("<ign>", {
          description: t("command.mcnames.arg_ign", "The player's username"),
        })
        .handler((ctx) => commandHandler.handleMcnamesCommand(ctx));

      registry
        .command("setinparty")
        .description(
          t(
            "command.setinparty.description",
            "[DEBUG] Manually set the inParty status."
          )
        )
        .argument("<value>", {
          description: t("command.setinparty.arg_value", "true or false"),
        })
        .handler((ctx) => commandHandler.handleSetInPartyCommand(ctx));
      registry
        .command("rerank")
        .description(
          t(
            "command.rerank.description",
            "Forces team ranking and refreshes tab list stats."
          )
        )
        .handler((ctx) => commandHandler.handleRerankCommand(ctx));
      registry
        .command("allstats")
        .description(
          t(
            "command.allstats.description",
            "Shows stats for all remaining players, or filter by team color."
          )
        )
        .argument("[color]", {
          description: t(
            "command.allstats.arg_color",
            "Optional team color (red, blue, green, yellow, aqua, white, pink, gray)"
          ),
          optional: true,
        })
        .argument("[sendTo]", {
          description: t(
            "command.allstats.arg_sendTo",
            "Where to send (private, team, party). Default: private"
          ),
          optional: true,
        })
        .handler((ctx) => commandHandler.handleAllStatsCommand(ctx));

      registry
        .command("gamestats")
        .description(
          t(
            "command.gamestats.description",
            "Shows real-time in-game statistics for the current match."
          )
        )
        .handler((ctx) => commandHandler.handleGameStatsCommand(ctx));
      registry
        .command("playerstats")
        .description(
          t(
            "command.playerstats.description",
            "Shows in-game statistics for a specific player in the current match."
          )
        )
        .argument("<player>", {
          description: t("command.playerstats.arg_player", "The player's username"),
        })
        .handler((ctx) => commandHandler.handlePlayerStatsCommand(ctx));

      registry
        .command("gametab")
        .description(
          t(
            "command.gametab.description",
            "Toggle or configure in-game stats display in tab."
          )
        )
        .argument("[setting]", {
          description: t(
            "command.gametab.arg_setting",
            "Setting to toggle: on/off, kills, deaths, fk, bb, or delay <5-10>"
          ),
          optional: true,
        })
        .argument("[value]", {
          description: t(
            "command.gametab.arg_value",
            "Value for delay setting (5-10)"
          ),
          optional: true,
        })
        .handler((ctx) => commandHandler.handleGameTabCommand(ctx));
    });
  }
}

module.exports = CommandRegistry;
