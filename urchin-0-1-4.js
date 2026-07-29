// Urchin Integration Plugin
// Provides automatic tag checking, blacklisting, and client tag display

const https = require('https');

const URCHIN_API_HOSTNAME = 'api.urchin.gg'; // 当前 Urchin API 的域名

module.exports = (api) => {
    api.metadata({
        name: 'urchin',
        displayName: 'Urchin Blacklist Integration',
        prefix: '§5BL',
        version: '0.1.4',
        author: 'Hexze',
        minVersion: '0.1.7',
        description: 'Integration with Urchin API for automatic blacklisting and client tags',
        dependencies: [
            { name: 'denicker', minVersion: '1.1.0' }
        ]
    });

    const urchin = new UrchinPlugin(api);
    
    const configSchema = [
        {
            label: 'API Key',
            description: 'Configure your Urchin API key',
            defaults: { 
                api: { 
                    apiKey: ''
                }
            },
            settings: [
                {
                    type: 'text',
                    key: 'api.apiKey',
                    description: 'Your Urchin API key (required for tag checking).', // 当前接口每次请求都需要 API key
                    placeholder: 'Enter your Urchin API key'
                }
            ]
        },
        {
            label: 'Alerts',
            description: 'Configure the plugin\'s chat alerts.',
            defaults: { 
                alerts: { 
                    enabled: true, 
                    audioAlerts: { enabled: true }, 
                    alertDelay: 0,
                    autoSendTagMessage: false
                }
            },
            settings: [
                {
                    type: 'toggle',
                    key: 'alerts.enabled',
                    text: ['OFF', 'ON'],
                    description: 'Enable or disable all chat alerts.'
                },
                {
                    type: 'soundToggle',
                    key: 'alerts.audioAlerts.enabled',
                    text: ['OFF', 'ON'],
                    description: 'Play a sound when a tagged player is found.'
                },
                {
                    type: 'toggle',
                    key: 'alerts.autoSendTagMessage',
                    text: ['OFF', 'ON'],
                    description: 'Automatically send found tag details to chat after lookup.'
                },
                {
                    type: 'cycle',
                    key: 'alerts.alertDelay',
                    description: 'The delay in milliseconds before sending a tag alert.',
                    displayLabel: 'Delay',
                    values: [
                        { text: '0ms', value: 0 },
                        { text: '500ms', value: 500 },
                        { text: '1000ms', value: 1000 }
                    ]
                }
            ]
        },
        {
            label: 'Label Tags in Tab',
            description: 'Enable or disable tab suffixes for tagged players.',
            defaults: { modifyDisplayNames: { enabled: true } },
            settings: [
                {
                    type: 'toggle',
                    key: 'modifyDisplayNames.enabled',
                    text: ['OFF', 'ON'],
                    description: 'Adds a label to tagged players in tab to indicate their tags.',
                    onChange: (enabled) => {
                        if (enabled) {
                            for (const [uuid, data] of urchin.taggedDisplayNames) {
                                const tagIcon = urchin.getTagIcon(data.tag.type);
                                const tagColor = urchin.getTagColor(data.tag.type);
                                const tagSuffix = ` §8[§${tagColor}${tagIcon}§8]§r`;
                                urchin.api.appendDisplayNameSuffix(uuid, tagSuffix);
                            }
                        } else {
                            urchin._clearDisplayNames();
                        }
                    }
                }
            ]
        },
        {
            label: 'Check Team Members',
            description: 'Automatically check tags for team members.',
            defaults: { automatic: { checkTeams: true } },
            settings: [
                {
                    type: 'toggle',
                    key: 'automatic.checkTeams',
                    text: ['OFF', 'ON'],
                    description: 'Automatically check tags for team members in games.'
                }
            ]
        }
    ];

    api.initializeConfig(configSchema);
    api.configSchema(configSchema);

    api.commands((registry) => {
        registry.command('v')
            .description('Check Urchin tags for specific users')
            .argument('<usernames>', 'Usernames to check (space separated)')
            .handler((ctx) => urchin.handleVCommand(ctx.args.usernames));
        
        registry.command('tag')
            .description('Add a tag to a player')
            .argument('<player>', 'Player to tag')
            .argument('<tagtype>', 'Type of tag')
            .argument('<reason>', { type: 'greedy', description: 'Reason for tag (can be multiple words)' })
            .handler((ctx) => {
                urchin.handleTagCommand(ctx.args.player, ctx.args.tagtype, ctx.args.reason, false);
            });
        
        registry.command('forcetag')
            .description('Force add a tag to a player (overwrite existing)')
            .argument('<player>', 'Player to tag')
            .argument('<tagtype>', 'Type of tag')
            .argument('<reason>', { type: 'greedy', description: 'Reason for tag (can be multiple words)' })
            .handler((ctx) => {
                urchin.handleTagCommand(ctx.args.player, ctx.args.tagtype, ctx.args.reason, true);
            });
        
        registry.command('setkey')
            .description('Set your Urchin API key')
            .argument('<apikey>', 'Your Urchin API key')
            .handler((ctx) => urchin.handleSetKeyCommand(ctx.args.apikey));
        
        registry.command('testapi')
            .description('Test your Urchin API connection')
            .handler(() => urchin.handleTestApiCommand());
    });
    
    urchin.registerHandlers();
    return urchin;
};

class UrchinPlugin {
    constructor(api) {
        this.api = api;
        this.PLUGIN_PREFIX = this.api.getPrefix();
        this.taggedDisplayNames = new Map();
        this.nextAutoSendAt = 0;
        this.inParty = null;
        
        this.VALID_TAG_TYPES = [
            'info', 'caution', 'closet_cheater', 'confirmed_cheater', 
            'blatant_cheater', 'possible_sniper', 'sniper', 'legit_sniper', 'account'
        ];
    }

    registerHandlers() {
        this.api.on('chat', this.onChat.bind(this));
        this.api.on('respawn', this.onRespawn.bind(this));
        this.api.on('plugin_restored', this.onPluginRestored.bind(this));
    }

    onRespawn(event) {
        this.taggedDisplayNames.clear();
        this.nextAutoSendAt = 0;
        this.api.clearAllDisplayNames();
    }

    onPluginRestored(event) {
        if (event.pluginName === 'urchin') {
            this.taggedDisplayNames.clear();
            this.nextAutoSendAt = 0;
            this.inParty = null;
        }
    }

    onChat(event) {
        const cleanText = this.stripColorCodes(event.message);
        this.updatePartyStatus(cleanText);

        if (!this.api.config.get('alerts.enabled')) return;
        if (event.position === 2) return;
        
        if (cleanText.startsWith('ONLINE:')) {
            const usernames = cleanText
                .replace('ONLINE:', '')
                .split(',')
                .map(name => name.trim())
                .filter(name => name.length > 0);
            
            const denickerPlugin = this.api.getPluginInstance('denicker');
            if (denickerPlugin) {
                const resolvedNicks = [];
                const nickMappings = new Map();
                
                for (const username of usernames) {
                    const realName = denickerPlugin.getRealName(username);
                    if (realName) {
                        resolvedNicks.push(realName);
                        nickMappings.set(realName, username);
                        this.api.debugLog(`Urchin: Found resolved nick ${username} -> ${realName}`);
                    }
                }
                
                if (resolvedNicks.length > 0) {
                    this.batchCheckUrchinTags(resolvedNicks).then(response => {
                        for (const realName in response.players) {
                            const tags = response.players[realName];
                            const nickName = nickMappings.get(realName);
                            
                            if (tags && tags.length > 0 && nickName) {
                                this.displayDenickedTags(nickName, realName, tags);
                                
                                if (this.api.config.get('modifyDisplayNames.enabled')) {
                                    const player = this.api.getPlayerByName(nickName);
                                    if (player) {
                                        const priorityTag = this.getHighestPriorityTag(tags);
                                        const tagIcon = this.getTagIcon(priorityTag.type);
                                        const tagColor = this.getTagColor(priorityTag.type);
                                        const tagSuffix = ` §8[§${tagColor}${tagIcon}§8]§r`;
                                        
                                        this.taggedDisplayNames.set(player.uuid, { username: nickName, tag: priorityTag, realName: realName });
                                        this.api.appendDisplayNameSuffix(player.uuid, tagSuffix);
                                    }
                                }
                            }
                        }
                        
                        if (Object.keys(response.players).some(name => response.players[name]?.length > 0)) {
                            if (this.api.config.get('alerts.audioAlerts.enabled')) {
                                this.api.sound('note.pling');
                            }
                        }
                    }).catch(err => {
                        this.api.debugLog(`Urchin: Error checking resolved nicks: ${err.message}`);
                    });
                }
            }
            
            this.processUsernames(usernames, false);
        }
    }

    handleVCommand(args) {
        if (!this.api.config.get('alerts.enabled')) {
            this.sendErrorMessage('Urchin tag checking is disabled');
            return;
        }
        
        if (!args || args.trim() === '') {
            this.sendUsageMessage();
            return;
        }
        
        const usernames = args.split(' ').filter(Boolean);
        this.checkUsernamesOnly(usernames);
    }

    checkUsernamesOnly(usernames) {
        this.batchCheckUrchinTags(usernames).then(response => {
            this.displayTagResults(response, usernames, { infoOnly: true });
        }).catch(err => {
            if (err.message === "Invalid API Key") {
                this.sendErrorMessage('Invalid API key detected. Plugin has been disabled.');
                this.api.config.set('alerts.enabled', false);
            } else {
                this.sendErrorMessage(`Error checking tags: ${err.message}`);
            }
        });
    }
    
    /**
     * 显示去昵称玩家的标签详情，并在理由为空时使用默认文本。
     */
    displayDenickedTags(nickName, realName, tags) {
        const player = this.api.getPlayerByName(nickName);
        const team = player ? this.api.getPlayerTeam(player.name) : null;
        const prefix = team?.prefix || '';
        const suffix = team?.suffix || '';
        
        const teamFormattedName = `${prefix}${nickName} §c(${realName})§r${suffix}`;
        
        const hoverText = [
            { text: `§5Urchin Blacklist Tags\n` },
            { text: `§7§m-------------------------------------§r\n` }
        ];
        
        tags.forEach((tag, index) => {
            const timeAgo = this.getTimeAgo(tag.added_on);
            const tagType = this.formatTagType(tag.type);
            const tagColor = this.getTagColor(tag.type);
            const tagIcon = this.getTagIcon(tag.type);
            const reason = this.getTagReason(tag); // 标签理由为空时显示 unknown
            
            hoverText.push({ text: `§${tagColor}${tagType} [${tagIcon}]\n` });
            hoverText.push({ text: `§9"${reason}"\n` });
            hoverText.push({ text: `§7- Added ${timeAgo}\n` });
            
            if (index < tags.length - 1) {
                hoverText.push({ text: `\n` });
            }
        });
        
        hoverText.push({ text: `\n§8Click to paste info in chat` });

        const tagComponents = [];
        const tagMessagesForAutoSend = [];
        tags.forEach((tag, index) => {
            const tagIcon = this.getTagIcon(tag.type);
            const tagColor = this.getTagColor(tag.type);
            const timeAgo = this.getTimeAgo(tag.added_on);
            const tagType = this.formatTagType(tag.type);
            const reason = this.getTagReason(tag); // 标签理由为空时显示 unknown
            const tagMessage = `⚠ ${nickName} (${realName}) 发现Tags："${reason}" -- ${timeAgo}前添加，请不要作弊喵~`;

            tagMessagesForAutoSend.push(tagMessage);
            
            tagComponents.push({
                text: `${index === 0 ? ' ' : ''}§8[§${tagColor}${tagIcon}§8]§r`,
                hoverEvent: {
                    action: "show_text",
                    value: { text: "", extra: hoverText }
                },
                clickEvent: {
                    action: "suggest_command",
                    value: tagMessage
                }
            });
        });

        const message = {
            text: `${this.PLUGIN_PREFIX} `,
            extra: [
                { 
                    text: teamFormattedName,
                    color: "white",
                    clickEvent: {
                        action: "suggest_command",
                        value: `${nickName} (${realName})`
                    },
                    hoverEvent: {
                        action: "show_text",
                        value: { text: "§8Click to put names in chat" }
                    }
                },
                ...tagComponents
            ]
        };
        
        this.api.chat(message);
        this.queueTagMessagesForAutoSend(tagMessagesForAutoSend, false);
    }

    displayTagResults(response, usernames, options = {}) {
        const { infoOnly = false } = options;
        let hasAnyTags = false;
        
        for (const username in response.players) {
            const tags = response.players[username];
            
            if (tags && tags.length > 0) {
                hasAnyTags = true;
                this.displayTagMessage(username, tags, infoOnly);
                
                if (!infoOnly) {
                    const priorityTag = this.getHighestPriorityTag(tags);
                    this.updatePlayerDisplayName(username, priorityTag);
                }
            }
        }

        if (hasAnyTags && !infoOnly && this.api.config.get('alerts.audioAlerts.enabled')) {
            this.api.sound('note.pling');
        }

        const action = infoOnly ? 'Checked' : 'Found';
        this.sendInfoMessage(`${action} ${usernames.length} player${usernames.length === 1 ? '' : 's'} - ${hasAnyTags ? 'Found tags!' : 'No tags found'}`);
    }

    handleSetKeyCommand(apiKey) {
        if (!apiKey || apiKey.trim() === '') {
            this.sendErrorMessage('Usage: /urchin setkey <your-api-key>');
            return;
        }
        
        this.api.config.set('api.apiKey', apiKey.trim());
        this.sendSuccessMessage('API key has been set successfully!');
        this.sendInfoMessage('You can now test it with /urchin testapi');
    }

    /**
     * 测试当前配置的 Urchin API key 是否可以访问当前 API。
     */
    async handleTestApiCommand() {
        const apiKey = this.api.config.get('api.apiKey');
        if (!apiKey || apiKey.trim() === '') {
            this.sendErrorMessage('API key not configured. Set it in plugin config.');
            return;
        }

        this.sendInfoMessage('Testing API connection with API key...');

        try {
            const testResponse = await this.testApiConnection(); // 通过当前版本接口验证鉴权
            if (testResponse.valid) {
                this.sendSuccessMessage('API key is valid and working!');
            } else {
                this.sendErrorMessage(`API test failed with status ${testResponse.statusCode}`);
            }
        } catch (error) {
            if (error.message === 'Invalid API Key') {
                this.sendErrorMessage('Invalid API key - use "/urchin setkey <key>" to update it');
            } else {
                this.sendErrorMessage(`API test failed: ${error.message}`);
            }
        }
    }

    handleTagCommand(player, tagType, reason, isForce) {
        if (!this.api.config.get('alerts.enabled')) {
            this.sendErrorMessage('Urchin tag checking is disabled');
            return;
        }

        if (!player || !tagType || !reason) {
            this.sendErrorMessage(`Usage: /${isForce ? 'forcetag' : 'tag'} <player> <tagtype> <reason>`);
            this.sendErrorMessage(`Valid tag types: ${this.VALID_TAG_TYPES.join(', ')}`);
            return;
        }
        
        const apiKey = this.api.config.get('api.apiKey');
        if (!apiKey) {
            this.sendErrorMessage('API key not configured. Set it in plugin config.');
            return;
        }
        
        const normalizedTagType = this.expandTagType(tagType);
        
        if (!this.VALID_TAG_TYPES.includes(normalizedTagType)) {
            this.sendErrorMessage(`Invalid tag type. Valid options: ${this.VALID_TAG_TYPES.join(', ')}`);
            this.sendErrorMessage(`Short forms: I, C, CC, BC, CCC, A, PS, S, LS`);
            return;
        }
        
        const reasonText = Array.isArray(reason) ? reason.join(' ') : reason;
        
        this.sendInfoMessage(`Processing tag for ${player}...`);
        
        this.addTagToPlayer(player, normalizedTagType, reasonText, false, isForce);
    }

    async addTagToPlayer(player, tagType, reason, hideUsername, overwrite) {
        try {
            const uuid = await this.usernameToUUID(player);
            const response = await this.addTag(uuid, tagType, reason, hideUsername, overwrite);
            
            if (response.statusCode === 200) {
                this.sendSuccessMessage(`Successfully added ${this.formatTagType(tagType)} tag to ${player}`);
            } else if (response.statusCode === 422) {
                this.sendErrorMessage('Tag already exists. Use /forcetag to overwrite.');
            } else if (response.statusCode === 409) {
                this.handleTagConflict(response.data, player);
            } else {
                this.sendErrorMessage(`Error: ${response.statusCode} - ${response.data || 'Unknown error'}`);
            }
        } catch (error) {
            this.sendErrorMessage(`Error: ${error.message}`);
        }
    }

    handleTagConflict(responseData, player) {
        try {
            const errorData = JSON.parse(responseData);
            if (errorData.detail && errorData.detail.current_tags) {
                const existingTag = errorData.detail.current_tags[0];
                const tagType = existingTag.tag_type;
                const reason = existingTag.reason;
                const addedOn = new Date(existingTag.added_on);
                const dateString = addedOn.toLocaleDateString() + ' ' + addedOn.toLocaleTimeString();
                
                this.sendErrorMessage(`${player} already has a ${this.formatTagType(tagType)} tag:`);
                this.sendInfoMessage(`Reason: ${reason}`);
                this.sendInfoMessage(`Added: ${dateString}`);
                this.sendInfoMessage('Use /forcetag to overwrite.');
            } else {
                this.sendErrorMessage('User already has a tag. Use /forcetag to overwrite.');
            }
        } catch (error) {
            this.sendErrorMessage('User already has a tag. Use /forcetag to overwrite.');
        }
    }

    async checkApiKeyValid() {
        const apiKey = this.api.config.get('api.apiKey');
        if (!apiKey) {
            this.sendErrorMessage('API key not configured. Set it in plugin config.');
            return false;
        }

        try {
            const testResponse = await this.testApiConnection();
            return testResponse.valid;
        } catch (error) {
            if (error.message === "Invalid API Key") {
                this.sendErrorMessage('Invalid API key detected. Plugin has been disabled.');
                this.api.config.set('alerts.enabled', false);
                return false;
            }
            return false;
        }
    }

    /**
     * 使用新版批量查询接口验证 API key，并返回鉴权结果。
     */
    async testApiConnection() {
        const response = await this.requestUrchin('/v3/players', 'POST', { uuids: [] }); // 空批量请求只用于验证 key

        if (response.statusCode === 401) {
            throw new Error('Invalid API Key');
        }

        return {
            valid: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode
        };
    }

    processUsernames(usernames, skipIgnore = false) {
        const ignoredUsers = this.getIgnoredUsers();
        const filteredUsernames = skipIgnore ? usernames : usernames.filter(username => !ignoredUsers.includes(username));
        
        if (filteredUsernames.length === 0) return;
        
        this.batchCheckUrchinTags(filteredUsernames).then(response => {
            this.displayTagResults(response, filteredUsernames, { infoOnly: false });
            
        }).catch(err => {
            if (err.message === "Invalid API Key") {
                this.sendErrorMessage('Invalid API key detected. Plugin has been disabled.');
                this.api.config.set('alerts.enabled', false);
            } else {
                this.sendErrorMessage(`Error checking tags: ${err.message}`);
            }
        });
    }

    updatePlayerDisplayName(username, tag) {
        if (!this.api.config.get('modifyDisplayNames.enabled')) return;
        
        const player = this.api.getPlayerByName(username);
        if (!player) {
            this.api.debugLog(`Urchin: Could not find player for username: ${username}`);
            return;
        }
        
        const tagIcon = this.getTagIcon(tag.type);
        const tagColor = this.getTagColor(tag.type);
        const tagSuffix = ` §8[§${tagColor}${tagIcon}§8]§r`;
        
        this.taggedDisplayNames.set(player.uuid, { username: player.name, tag });
        this.api.appendDisplayNameSuffix(player.uuid, tagSuffix);
    }

    _clearDisplayNames() {
        for (const [uuid] of this.taggedDisplayNames) {
            this.api.clearDisplayNameSuffix(uuid);
        }
        this.api.debugLog('Urchin: Cleared all tag display names');
    }

    getHighestPriorityTag(tags) {
        const hasNonAccountTags = tags.some(tag => tag.type !== 'account');
        if (hasNonAccountTags) {
            const nonAccountTags = tags.filter(tag => tag.type !== 'account');
            return nonAccountTags[0];
        }

        return tags[0];
    }

    isAutoSendTagMessageEnabled() {
        return this.api.config.get('alerts.autoSendTagMessage') === true;
    }

    isInParty() {
        return this.inParty === true;
    }

    shouldAutoSendTagMessages(infoOnly = false) {
        if (!this.isAutoSendTagMessageEnabled()) return false;
        if (!infoOnly) return true;
        return this.isInParty();
    }

    updatePartyStatus(cleanText) {
        const trimmedMessage = cleanText.trim();

        const joinRegex = /^You have joined (.*)'s party!$/;
        const createRegex = /^You have invited (.*) to your party!?/;
        const memberJoinRegex = /^(.*) joined the party\.$/;

        if (
            joinRegex.test(trimmedMessage) ||
            createRegex.test(trimmedMessage) ||
            memberJoinRegex.test(trimmedMessage)
        ) {
            this.inParty = true;
            return;
        }

        const partyLeaveTriggers = [
            "You left the party.",
            "The party was disbanded because all invites expired and the party was empty.",
            "The party was disbanded.",
        ];

        if (
            partyLeaveTriggers.includes(trimmedMessage) ||
            trimmedMessage.startsWith("You have been kicked from the party by") ||
            trimmedMessage.startsWith("The party was disbanded because")
        ) {
            this.inParty = false;
        }
    }

    getTagAutoSendDelay() {
        const configuredDelay = Number(this.api.config.get('alerts.alertDelay')) || 0;
        return Math.max(2500, configuredDelay) + 1500;
    }

    queueTagMessageForAutoSend(message) {
        if (!this.isAutoSendTagMessageEnabled()) return;

        const cleanedMessage = this.stripColorCodes(message).trim();
        if (!cleanedMessage) return;

        const now = Date.now();
        const scheduledAt = Math.max(now + this.getTagAutoSendDelay(), this.nextAutoSendAt);
        const waitMs = Math.max(0, scheduledAt - now);

        this.nextAutoSendAt = scheduledAt + 450;
        setTimeout(() => {
            try {
                this.api.sendChatToServer(cleanedMessage);
            } catch (error) {
                this.api.debugLog(`Urchin: Failed to auto-send tag message: ${error.message}`);
            }
        }, waitMs);
    }

    queueTagMessagesForAutoSend(messages, infoOnly = false) {
        if (!this.shouldAutoSendTagMessages(infoOnly)) return;
        if (!Array.isArray(messages) || messages.length === 0) return;
        for (const message of messages) {
            this.queueTagMessageForAutoSend(message);
        }
    }

    /**
     * 显示玩家标签详情，并在理由为空时使用默认文本。
     */
    displayTagMessage(username, tags, infoOnly = false) {
        let teamFormattedName = username;
        if (!infoOnly) {
            const player = this.api.getPlayerByName(username);
            const team = player ? this.api.getPlayerTeam(player.name) : null;
            const prefix = team?.prefix || '';
            const suffix = team?.suffix || '';
            teamFormattedName = prefix + username + suffix;
        }
        
        const hoverText = [
            { text: `§5Urchin Blacklist Tags\n` },
            { text: `§7§m-------------------------------------§r\n` }
        ];
        
        tags.forEach((tag, index) => {
            const timeAgo = this.getTimeAgo(tag.added_on);
            const tagType = this.formatTagType(tag.type);
            const tagColor = this.getTagColor(tag.type);
            const tagIcon = this.getTagIcon(tag.type);
            const reason = this.getTagReason(tag); // 标签理由为空时显示 unknown
            
            hoverText.push({ text: `§${tagColor}${tagType} [${tagIcon}]\n` });
            hoverText.push({ text: `§9"${reason}"\n` });
            hoverText.push({ text: `§7- Added ${timeAgo}\n` });
            
            if (index < tags.length - 1) {
                hoverText.push({ text: `\n` });
            }
        });
        
        hoverText.push({ text: `\n§8Click to paste info in chat` });

        const tagComponents = [];
        const tagMessagesForAutoSend = [];
        tags.forEach((tag, index) => {
            const tagIcon = this.getTagIcon(tag.type);
            const tagColor = this.getTagColor(tag.type);
            const timeAgo = this.getTimeAgo(tag.added_on);
            const tagType = this.formatTagType(tag.type);
            const reason = this.getTagReason(tag); // 标签理由为空时显示 unknown
            const tagMessage = `⚠ ${username} 发现Tags："${reason}" -- ${timeAgo}前添加，请不要作弊喵~`;

            tagMessagesForAutoSend.push(tagMessage);
            
            tagComponents.push({
                text: `${index === 0 ? ' ' : ''}§8[§${tagColor}${tagIcon}§8]§r`,
                hoverEvent: {
                    action: "show_text",
                    value: { text: "", extra: hoverText }
                },
                clickEvent: {
                    action: "suggest_command",
                    value: tagMessage
                }
            });
        });

        const message = {
            text: `${this.PLUGIN_PREFIX} `,
            extra: [
                { 
                    text: teamFormattedName, 
                    color: "white",
                    clickEvent: {
                        action: "suggest_command",
                        value: username
                    },
                    hoverEvent: {
                        action: "show_text",
                        value: { text: "§8Click to put username in chat" }
                    }
                },
                ...tagComponents
            ]
        };
        
        this.api.chat(message);
        this.queueTagMessagesForAutoSend(tagMessagesForAutoSend, infoOnly);
    }

    /**
     * 查询多个玩家的 Urchin 标签，并兼容插件原有的批量响应结构。
     */
    async batchCheckUrchinTags(usernames) {
        const apiKey = this.api.config.get('api.apiKey');
        if (!apiKey || apiKey.trim() === '') {
            throw new Error('API key not configured');
        }

        const uniqueUsernames = [...new Set(usernames.filter(Boolean))]; // 避免同一玩家重复消耗请求额度
        const results = await Promise.all(uniqueUsernames.map(async (username) => {
            const path = `/v3/player/tags?player=${encodeURIComponent(username)}`; // v3 接口支持直接传入用户名
            const response = await this.requestUrchin(path, 'GET'); // API key 通过 X-API-Key 请求头发送

            if (response.statusCode === 401) {
                throw new Error('Invalid API Key');
            }

            if (response.statusCode === 404) {
                return [username, []];
            }

            if (response.statusCode < 200 || response.statusCode >= 300) {
                const errorMessage = response.body?.error || `Urchin API error (${response.statusCode})`;
                throw new Error(errorMessage);
            }

            const tags = Array.isArray(response.body?.tags)
                ? response.body.tags.map(tag => ({
                    ...tag,
                    type: tag.tag_type || tag.type // 将 API v3 的 tag_type 转为插件内部字段
                }))
                : [];

            return [username, tags];
        }));

        return { players: Object.fromEntries(results) }; // 保持现有显示和告警逻辑无需改动
    }

    /**
     * 发送 Urchin API 请求并统一解析 JSON 响应。
     */
    requestUrchin(path, method = 'GET', body = null) {
        const apiKey = this.api.config.get('api.apiKey');
        const jsonBody = body === null ? null : JSON.stringify(body);

        return new Promise((resolve, reject) => {
            const headers = {
                'X-API-Key': apiKey // 当前 API 要求使用 X-API-Key 请求头
            };

            if (jsonBody !== null) {
                headers['Content-Type'] = 'application/json'; // JSON 请求体的类型
                headers['Content-Length'] = Buffer.byteLength(jsonBody); // 设置请求体字节长度
            }

            const options = {
                hostname: URCHIN_API_HOSTNAME, // 使用当前 Urchin API 域名
                path: path,
                method: method,
                headers: headers
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    let responseBody = null;
                    try {
                        responseBody = data ? JSON.parse(data) : null;
                    } catch (error) {
                        reject(new Error(`Failed to parse Urchin API response: ${error.message}`));
                        return;
                    }

                    resolve({
                        statusCode: res.statusCode,
                        body: responseBody,
                        raw: data
                    });
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Urchin API request failed: ${error.message}`));
            });

            if (jsonBody !== null) {
                req.write(jsonBody); // 发送 JSON 请求体
            }
            req.end();
        });
    }

    async usernameToUUID(username) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.mojang.com',
                path: `/users/profiles/minecraft/${encodeURIComponent(username)}`,
                method: 'GET'
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const response = JSON.parse(data);
                            if (response && response.id) {
                                const uuid = response.id.replace(
                                    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
                                    '$1-$2-$3-$4-$5'
                                );
                                resolve(uuid);
                            } else {
                                reject(new Error('Invalid response from Mojang API'));
                            }
                        } catch (error) {
                            reject(new Error(`Failed to parse response: ${error.message}`));
                        }
                    } else if (res.statusCode === 204 || res.statusCode === 404) {
                        reject(new Error(`Player not found: ${username}`));
                    } else {
                        reject(new Error(`Mojang API error: ${res.statusCode}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });

            req.end();
        });
    }

    async addTag(uuid, tagType, reason, hideUsername, overwrite) {
        const apiKey = this.api.config.get('api.apiKey');
        
        return new Promise((resolve, reject) => {
            const undashedUuid = uuid.replace(/-/g, '');
            
            const requestBody = {
                uuid: undashedUuid,
                tag_type: tagType.toLowerCase(),
                reason: reason,
                hide_username: hideUsername,
                overwrite: overwrite
            };
            
            const jsonBody = JSON.stringify(requestBody);
            
            const options = {
                hostname: 'urchin.ws',
                path: `/admin/add-tag?key=${apiKey}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(jsonBody)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        data: data
                    });
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request failed: ${error.message}`));
            });
            
            req.write(jsonBody);
            req.end();
        });
    }

    getIgnoredUsers() {
        const ignoredString = '';
        return ignoredString.split(',').map(name => name.trim()).filter(name => name.length > 0);
    }

    extractTextFromJson(message) {
        if (typeof message === 'string') {
            try {
                const parsed = JSON.parse(message);
                if (parsed.extra) {
                    return parsed.extra.map(part => part.text || '').join('');
                }
                return parsed.text || '';
            } catch (e) {
                return message;
            }
        }
        return message.text || '';
    }

    stripColorCodes(text) {
        return text.replace(/§[0-9a-fk-or]/g, '');
    }

    extractUsername(text) {
        return this.stripColorCodes(text)
            .replace(/^\[.*?\]\s*/, '')
            .trim();
    }

    getTimeAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);
        
        if (diffInSeconds < 60) return 'just now';
        
        const diffInMinutes = Math.floor(diffInSeconds / 60);
        if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'} ago`;
        
        const diffInHours = Math.floor(diffInMinutes / 60);
        if (diffInHours < 24) return `${diffInHours} hour${diffInHours === 1 ? '' : 's'} ago`;
        
        const diffInDays = Math.floor(diffInHours / 24);
        if (diffInDays < 30) return `${diffInDays} day${diffInDays === 1 ? '' : 's'} ago`;
        
        const diffInMonths = Math.floor(diffInDays / 30);
        if (diffInMonths < 12) return `${diffInMonths} month${diffInMonths === 1 ? '' : 's'} ago`;
        
        const diffInYears = Math.floor(diffInMonths / 12);
        return `${diffInYears} year${diffInYears === 1 ? '' : 's'} ago`;
    }

    formatTagType(type) {
        return type.split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * 获取标签理由，空值或仅包含空格时返回 unknown。
     */
    getTagReason(tag) {
        const reason = typeof tag?.reason === 'string' ? tag.reason.trim() : '';
        return reason || 'unknown'; // 标签没有有效理由时使用默认文本
    }

    getTagIcon(type) {
        switch (type) {
            case 'info':
                return 'I';
            case 'caution':
                return 'C';
            case 'closet_cheater':
                return 'CC';
            case 'blatant_cheater':
                return 'BC';
            case 'confirmed_cheater':
                return 'CCC';
            case 'account':
                return 'A';
            case 'possible_sniper':
                return 'PS';
            case 'sniper':
                return 'S';
            case 'legit_sniper':
                return 'LS';
            default:
                return '?';
        }
    }

    expandTagType(shortForm) {
        const shortFormMap = {
            'i': 'info',
            'c': 'caution',
            'cc': 'closet_cheater',
            'bc': 'blatant_cheater',
            'ccc': 'confirmed_cheater',
            'a': 'account',
            'ps': 'possible_sniper',
            's': 'sniper',
            'ls': 'legit_sniper'
        };
        
        const normalized = shortForm.toLowerCase();
        return shortFormMap[normalized] || normalized;
    }

    getTagColor(type) {
        switch (type) {
            case 'info':
                return '7'; // light_gray
            case 'closet_cheater':
                return '6'; // gold
            case 'blatant_cheater':
                return '6'; // gold
            case 'account':
                return '6'; // gold
            case 'caution':
                return '6'; // gold
            case 'confirmed_cheater':
                return '5'; // dark_purple
            case 'sniper':
                return '4'; // dark_red
            case 'legit_sniper':
                return 'c'; // red
            case 'possible_sniper':
                return 'c'; // red
            default:
                return 'f'; // white
        }
    }

    sendErrorMessage(message) {
        this.api.chat(`${this.PLUGIN_PREFIX} §c${message}`);
    }

    sendSuccessMessage(message) {
        this.api.chat(`${this.PLUGIN_PREFIX} §a${message}`);
    }

    sendInfoMessage(message) {
        this.api.chat(`${this.PLUGIN_PREFIX} §e${message}`);
    }

    sendUsageMessage() {
        this.api.chat(`${this.PLUGIN_PREFIX} §eUsage: /v <username>`);
    }
}
