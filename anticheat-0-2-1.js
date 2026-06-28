// Advanced Anticheat System
// Adapted from Pug's Custom Anticheat Raven script (github.com/PugrillaDev)

module.exports = (api) => {
    api.metadata({
        name: 'anticheat',
        displayName: 'Cheater Detector',
        prefix: '§cAC',
        version: '0.2.1',
        author: 'Hexze',
        description: 'Advanced cheater detector system (Inspired by github.com/PugrillaDev)',
    });

    const anticheat = new AnticheatSystem(api);
    
    const configSchema = [];
    const checkDefinitions = getCheckDefinitions();
    
    for (const checkName in checkDefinitions) {
        const defaultCheckConfig = checkDefinitions[checkName];
        const sectionLabel = getCheckSectionLabel(checkName); // 为手持物品检测提供独立的三条配置标题
        configSchema.push(createCheckSection(checkName, defaultCheckConfig, sectionLabel));
    }

    api.initializeConfig(configSchema);
    api.configSchema(configSchema);
    
    anticheat.registerHandlers();

    return {
        enable: () => {
            anticheat.refreshConfigConstants();
            api.debugLog('[AC] Anticheat plugin enabled with debug logging');
        },
        disable: () => {
            anticheat.cleanup();
            api.debugLog('[AC] Anticheat plugin disabled');
        }
    };
};

/**
 * 创建单个检测项的配置分组
 */
function createCheckSection(checkName, defaultCheckConfig, label = checkName) {
    return {
        label,
        defaults: { checks: { [checkName]: defaultCheckConfig } },
        settings: [
            {
                type: 'toggle',
                key: `checks.${checkName}.enabled`,
                text: ['OFF', 'ON'],
                description: defaultCheckConfig.description || `Enables or disables the ${checkName} check.`
            },
            {
                type: 'soundToggle',
                key: `checks.${checkName}.sound`,
                condition: (cfg) => cfg.checks[checkName].enabled,
                description: 'Toggles sound alerts for this check.'
            },
            {
                type: 'cycle',
                key: `checks.${checkName}.vl`,
                values: [
                    { text: 'VL: 5', value: 5 },
                    { text: 'VL: 10', value: 10 },
                    { text: 'VL: 15', value: 15 },
                    { text: 'VL: 20', value: 20 },
                    { text: 'VL: 30', value: 30 }
                ],
                condition: (cfg) => cfg.checks[checkName].enabled,
                description: 'Sets the violation level to trigger an alert.'
            },
            {
                type: 'cycle',
                key: `checks.${checkName}.cooldown`,
                values: [
                    { text: 'CD: 0s', value: 0 },
                    { text: 'CD: 1s', value: 1000 },
                    { text: 'CD: 2s', value: 2000 },
                    { text: 'CD: 3s', value: 3000 }
                ],
                condition: (cfg) => cfg.checks[checkName].enabled,
                description: 'Sets the cooldown between alerts for this check.'
            }
        ]
    };
}

/**
 * 返回检测项在 UI 中显示的标题
 */
function getCheckSectionLabel(checkName) {
    if (checkName === 'AntiItemObsidian') return 'AntiItem - Obsidian';
    if (checkName === 'AntiItemInvisibilityPotion') return 'AntiItem - Invis Pot';
    if (checkName === 'AntiItemEnderPearl') return 'AntiItem - Pearl';
    return checkName;
}

/**
 * 创建单个手持物品检测项的默认配置
 */
function createAntiItemCheckConfig(description) {
    return {
        enabled: false, // 默认关闭单独的手持物品检测
        sound: true, // 告警时默认播放提示音
        vl: 5, // 默认达到一次切换就可触发告警阈值
        cooldown: 2000, // 默认两秒内不重复提醒
        description
    };
}

const TEAM_COLOR_MAP = {
    R: '§c',
    B: '§9',
    G: '§a',
    Y: '§e',
    A: '§b',
    W: '§f',
    P: '§d',
    S: '§7'
};

const CHECKS = {
    NoSlowA: {
        config: { 
            enabled: true, sound: true, vl: 10, cooldown: 2000, 
            description: "Detects moving too fast while using items that should slow you down (eating food, drawing bow, blocking sword)." 
        },
        
        check: function(player, config) {
            const currentTime = Date.now();
            
            const isUsingSlowdownItem = player.isUsingItem && (
                player.isHoldingConsumable() || 
                player.isHoldingBow() || 
                (player.isHoldingSword() && player.isUsingItem)
            );
            
            const isSprinting = player.isSprinting;
            
            const isCurrentlyNoSlow = isUsingSlowdownItem && isSprinting;
            
            if (!player.noSlowData) {
                player.noSlowData = {
                    startTime: null,
                    isActive: false
                };
            }
            
            if (isCurrentlyNoSlow) {
                if (!player.noSlowData.isActive) {
                    player.noSlowData.startTime = currentTime;
                    player.noSlowData.isActive = true;
                }
                
                const noSlowDuration = currentTime - player.noSlowData.startTime;
                if (noSlowDuration >= 500) {
                    this.addViolation(player, 'NoSlowA', 2);
                    
                    if (this.shouldAlert(player, 'NoSlowA', config)) {
                        this.flag(player, 'NoSlowA', player.violations.NoSlowA);
                        this.markAlert(player, 'NoSlowA');
                    }
                }
            } else {
                player.noSlowData.isActive = false;
                player.noSlowData.startTime = null;
                this.reduceViolation(player, 'NoSlowA');
            }
        }
    },
    
    AutoBlockA: {
        config: { 
            enabled: true, sound: true, vl: 10, cooldown: 2000, 
            description: "Detects attacking while blocking with a sword." 
        },
        
        check: function(player, config) {
            const currentTime = Date.now();
            const isHoldingSword = player.isHoldingSword();
            const isSwinging = player.swingProgress > 0;
            
            if (!player.swingHistory) player.swingHistory = [];
            
            if (isSwinging && (!player.lastSwingDetected || currentTime - player.lastSwingDetected > 100)) {
                const hasBeenBlockingLongEnough = player.isBlocking && 
                    player.blockingStartTime && 
                    (currentTime - player.blockingStartTime >= 150);
                
                player.swingHistory.push({
                    time: currentTime,
                    wasBlockingBefore: hasBeenBlockingLongEnough,
                    wasBlockingAfter: null
                });
                player.lastSwingDetected = currentTime;
                
                if (player.swingHistory.length > 20) {
                    player.swingHistory.shift();
                }
            }
            
            player.swingHistory.forEach(swing => {
                if (swing.wasBlockingAfter === null) {
                    const timeSinceSwing = currentTime - swing.time;
                    if (timeSinceSwing >= 150 && timeSinceSwing <= 200) {
                        swing.wasBlockingAfter = player.isBlocking;
                    }
                    else if (timeSinceSwing > 200) {
                        swing.wasBlockingAfter = false;
                    }
                }
            });
            
            const recentSwings = player.swingHistory.filter(swing => 
                currentTime - swing.time < 1000 &&
                swing.wasBlockingAfter !== null &&
                isHoldingSword
            );
            
            let autoBlockCount = 0;
            recentSwings.forEach(swing => {
                const wasBlockingBefore = swing.wasBlockingBefore;
                const wasBlockingAfter = swing.wasBlockingAfter;
                
                if (wasBlockingBefore && wasBlockingAfter) {
                    autoBlockCount++;
                }
            });
            
            if (autoBlockCount >= 2) {
                this.addViolation(player, 'AutoBlockA');
                
                if (this.shouldAlert(player, 'AutoBlockA', config)) {
                    this.flag(player, 'AutoBlockA', player.violations.AutoBlockA);
                    this.markAlert(player, 'AutoBlockA');
                }
            } else {
                this.reduceViolation(player, 'AutoBlockA');
            }
        }
    },
    
    EagleA: {
        config: { 
            enabled: true, sound: true, vl: 5, cooldown: 2000, 
            description: "Detects diagonal double-shifting eagle (legit scaffold) patterns." 
        },

        check: function(player, config) {
            const isLookingDown = player.pitch >= 30;
            const isOnGround = player.onGround;
            const isSwingingBlock = player.swingProgress > 0 && player.isHoldingBlock();
            
            const horizontalSpeed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z);
            const isMovingFast = horizontalSpeed > 2.0;
            
            let movementAngle = Math.atan2(player.velocity.z, player.velocity.x) * 180 / Math.PI;
            if (movementAngle < 0) movementAngle += 360;
            const cardinalAngles = [0, 90, 180, 270];
            const isMovingStraight = cardinalAngles.some(angle => 
                Math.abs(movementAngle - angle) <= 15 || Math.abs(movementAngle - angle - 360) <= 15
            );
            const isMovingDiagonal = !isMovingStraight && horizontalSpeed > 0.1;
            
            const currentTime = Date.now();
            const recentShifts = player.shiftEvents.filter(event => 
                currentTime - event.timestamp < 2000 && event.type === 'start'
            );
            const shiftCount = recentShifts.length;
            const hasExcessiveShifts = shiftCount > 6 && horizontalSpeed > 2.5;
            
            const isEagle = isLookingDown && isOnGround && isSwingingBlock && 
                           isMovingDiagonal && isMovingFast && hasExcessiveShifts;

            if (isEagle) {
                this.addViolation(player, 'EagleA', 3);
                
                if (this.shouldAlert(player, 'EagleA', config)) {
                    this.flag(player, 'EagleA', player.violations.EagleA);
                    this.markAlert(player, 'EagleA');
                }
            } else {
                this.reduceViolation(player, 'EagleA', 3);
            }
        }
    },
    
    ScaffoldA: {
        config: { 
            enabled: false, sound: true, vl: 15, cooldown: 2000, 
            description: "Detects fast flat scaffold with no vertical movement" 
        },

        check: function(player, config) {
            const horizontalSpeed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z);
            
            const isLikelyDead = player.position.y > 100;
            if (isLikelyDead) {
                this.reduceViolation(player, 'ScaffoldA');
                return;
            }
            
            const isLookingDown = player.pitch >= 25;
            const isPlacingBlocks = player.swingProgress > 0 && player.isHoldingBlock();
            const isMovingFast = horizontalSpeed > 5.0;
            const isNotSneaking = !player.isCrouching;
            const isFlat = Math.abs(player.velocity.y) < 0.1;
            
            const isScaffold = isLookingDown && isPlacingBlocks && isMovingFast && isNotSneaking && isFlat;
            
            if (isScaffold) {
                this.addViolation(player, 'ScaffoldA', 1);
                
                if (this.shouldAlert(player, 'ScaffoldA', config)) {
                    this.flag(player, 'ScaffoldA', player.violations.ScaffoldA);
                    this.markAlert(player, 'ScaffoldA');
                }
            } else {
                this.reduceViolation(player, 'ScaffoldA');
            }
        }
    },

    AntiItemObsidian: {
        config: createAntiItemCheckConfig("Warns when a player switches to obsidian."),

        /**
         * 检测玩家是否切换到黑曜石
         */
        check: function(player, config) {
            this.runAntiItemCheck(player, 'AntiItemObsidian', config, {
                itemId: 49,
                alertLabel: 'OB'
            });
        }
    },

    AntiItemInvisibilityPotion: {
        config: createAntiItemCheckConfig("Warns when a player switches to an invisibility potion."),

        /**
         * 检测玩家是否切换到隐身药水
         */
        check: function(player, config) {
            this.runAntiItemCheck(player, 'AntiItemInvisibilityPotion', config, {
                itemId: 373,
                alertLabel: 'invs Pot',
                matcher: (heldItem) => this.isInvisibilityPotion(heldItem) // 仅命中带隐身效果的药水
            });
        }
    },

    AntiItemEnderPearl: {
        config: createAntiItemCheckConfig("Warns when a player switches to an ender pearl."),

        /**
         * 检测玩家是否切换到末影珍珠
         */
        check: function(player, config) {
            this.runAntiItemCheck(player, 'AntiItemEnderPearl', config, {
                itemId: 368,
                alertLabel: 'Pearl'
            });
        }
    },
    
    
    TowerA: {
        config: { 
            enabled: false, sound: true, vl: 10, cooldown: 2000, 
            description: "Detects ascending (towering) faster than normal while placing blocks below." 
        },
        
        check: function(player, config) {
            const currentTime = Date.now();
            const verticalSpeed = player.velocity.y;
            const horizontalSpeed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z);
            
            const isLookingDown = player.pitch >= 30;
            const isSwingingBlock = player.swingProgress > 0 && player.isHoldingBlock();
            const hasNoJumpBoost = !player.hasJumpBoost;
            const isAscendingFast = verticalSpeed > 5.5;
            
            const verticalToHorizontalRatio = horizontalSpeed > 0 ? verticalSpeed / horizontalSpeed : verticalSpeed;
            const hasProperTowerRatio = verticalToHorizontalRatio >= 0.8;
            
            const hasRecentDamage = player.lastDamaged > 0 && (currentTime - player.lastDamaged) < 500;
            
            if (!player.towerData) {
                player.towerData = {
                    heightHistory: [],
                    lastReset: currentTime
                };
            }
            
            if (currentTime - player.towerData.lastReset > 2000) {
                player.towerData.heightHistory = [];
                player.towerData.lastReset = currentTime;
            }
            
            if (isLookingDown && isSwingingBlock && isAscendingFast && hasProperTowerRatio && hasNoJumpBoost && !hasRecentDamage) {
                player.towerData.heightHistory.push({
                    y: player.position.y,
                    time: currentTime
                });
                
                if (player.towerData.heightHistory.length > 15) {
                    player.towerData.heightHistory.shift();
                }
            }
            
            if (player.towerData.heightHistory.length >= 8) {
                const heights = player.towerData.heightHistory;
                const start = heights[0];
                const end = heights[heights.length - 1];
                
                const totalHeightGain = end.y - start.y;
                const timeSpan = (end.time - start.time) / 1000;
                
                let consistentRiseCount = 0;
                for (let i = 1; i < heights.length; i++) {
                    if (heights[i].y > heights[i-1].y) {
                        consistentRiseCount++;
                    }
                }
                
                const consistencyRatio = consistentRiseCount / (heights.length - 1);
                const hasConsistentRise = consistencyRatio >= 0.8;
                const hasSignificantHeight = totalHeightGain >= 3.0;
                const hasGoodTimespan = timeSpan >= 0.4 && timeSpan <= 1.5;
                
                this.api.debugLog(`[TowerA] ${player.displayName} - VSpeed: ${verticalSpeed.toFixed(2)}, HSpeed: ${horizontalSpeed.toFixed(2)}, Ratio: ${verticalToHorizontalRatio.toFixed(2)}, HeightGain: ${totalHeightGain.toFixed(2)}, TimeSpan: ${timeSpan.toFixed(2)}s, ConsistentRise: ${consistentRiseCount}/${heights.length-1} (${consistencyRatio.toFixed(2)}), Consistent: ${hasConsistentRise}, SignificantHeight: ${hasSignificantHeight}, GoodTimespan: ${hasGoodTimespan}`);
                
                if (hasConsistentRise && hasSignificantHeight && hasGoodTimespan) {
                    this.addViolation(player, 'TowerA', 2);
                    
                    if (this.shouldAlert(player, 'TowerA', config)) {
                        this.flag(player, 'TowerA', player.violations.TowerA);
                        this.markAlert(player, 'TowerA');
                    }
                } else {
                    this.reduceViolation(player, 'TowerA');
                }
            }
        }
    }
};

const getCheckDefinitions = () => {
    const definitions = {};
    for (const [checkName, checkData] of Object.entries(CHECKS)) {
        definitions[checkName] = checkData.config;
    }
    return definitions;
};

class PlayerData {
    constructor(username, uuid, entityId) {
        this.username = username;
        this.uuid = uuid;
        this.entityId = entityId;
        this.displayName = username;
        
        this.position = { x: 0, y: 0, z: 0 };
        this.lastPosition = { x: 0, y: 0, z: 0 };
        this.onGround = true;
        this.lastOnGround = true;
        
        this.yaw = 0;
        this.pitch = 0;
        
        this.isCrouching = false;
        this.lastCrouching = false;
        this.isSprinting = false;
        this.isUsingItem = false;
        this.swingProgress = 0;
        
        this.lastSwingTime = 0;
        this.lastCrouchTime = 0;
        this.lastStopCrouchTime = 0;
        
        this.lastPositionData = null;
        this.velocity = { x: 0, y: 0, z: 0 };
        
        this.violations = {};
        this.lastAlerts = {};
        
        for (const checkName of Object.keys(CHECKS)) {
            this.violations[checkName] = 0;
            this.lastAlerts[checkName] = 0;
        }
        
        this.lastSwingItem = null;
        this.hasJumpBoost = false;
        
        this.shiftEvents = [];
        this.currentShiftStart = null;
        
        this.heldItem = null;
        
        this.lastSprinting = false;
        this.lastUsing = false;
        this.lastDamaged = 0;
        
        this.isBlocking = false;
        this.blockingStartTime = 0;
        this.lastAntiItemStates = {}; // 记录每个手持物品检测项上一次是否处于命中状态
    }
    
    updatePosition(x, y, z, onGround, yaw = null, pitch = null) {
        this.lastPosition = { ...this.position };
        this.position = { x, y, z };
        this.onGround = onGround;
        
        if (yaw !== null) this.yaw = yaw;
        if (pitch !== null) this.pitch = pitch;
        
        const currentTime = Date.now();
        let calculatedVelocity = { x: 0, y: 0, z: 0 };
        
        if (this.lastPositionData) {
            const timeDelta = (currentTime - this.lastPositionData.timestamp) / 1000;
            
            if (timeDelta > 0) {
                calculatedVelocity = {
                    x: (x - this.lastPositionData.position.x) / timeDelta,
                    y: (y - this.lastPositionData.position.y) / timeDelta,
                    z: (z - this.lastPositionData.position.z) / timeDelta
                };
            }
        }
        
        this.velocity = calculatedVelocity;
        
        this.lastPositionData = {
            position: { x, y, z },
            timestamp: currentTime
        };
        
        this.lastOnGround = onGround;
    }
    
    getItemId() {
        if (!this.heldItem) return null;
        return this.heldItem.blockId || this.heldItem.itemId || this.heldItem.id || null;
    }
    
    isHoldingBlock() {
        const itemId = this.getItemId();
        return itemId && itemId < 256;
    }
    
    isHoldingSword() {
        const itemId = this.getItemId();
        if (!itemId) return false;
        const swordIds = [267, 268, 272, 276, 283]; // wood, stone, iron, diamond, gold swords
        return swordIds.includes(itemId);
    }
    
    isHoldingBow() {
        const itemId = this.getItemId();
        return itemId === 261;
    }
    
    isHoldingConsumable() {
        const itemId = this.getItemId();
        if (!itemId) return false;
        const consumableIds = [
            260, // apple
            297, // bread
            319, // porkchop
            320, // cooked_porkchop
            322, // golden_apple
            335, // milk_bucket
            349, // fish
            350, // cooked_fish
            354, // cake (item)
            357, // cookie
            360, // melon_slice
            363, // beef
            364, // cooked_beef
            365, // chicken
            366, // cooked_chicken
            367, // rotten_flesh
            373, // potion
            391, // carrot
            392, // potato
            393, // baked_potato
            394, // poisonous_potato
            396, // golden_carrot
            400, // pumpkin_pie
            411, // rabbit
            412, // cooked_rabbit
            413, // rabbit_stew
            423, // mutton
            424  // cooked_mutton
        ];
        return consumableIds.includes(itemId);
    }
}

class AnticheatSystem {
    constructor(api) {
        this.api = api;
        this.players = new Map();
        this.playersByUuid = new Map();
        this.entityToPlayer = new Map();
        this.uuidToName = new Map();
        this.uuidToDisplayName = new Map();
        this.userPosition = null;

        this.CONFIG = {};
        this.refreshConfigConstants();
    }
    
    reset() {
        this.players.clear();
        this.playersByUuid.clear();
        this.entityToPlayer.clear();
        this.uuidToName.clear();
        this.uuidToDisplayName.clear();
        this.api.debugLog('Cleared all tracked player data.');
    }
    
    refreshConfigConstants() {
        this.CONFIG = {};
        for (const checkName of Object.keys(CHECKS)) {
            this.CONFIG[checkName] = {
                enabled: this.api.config.get(`checks.${checkName}.enabled`) ?? CHECKS[checkName].config.enabled, // 读取配置时为空则回退到检测项默认开关
                vl: this.api.config.get(`checks.${checkName}.vl`) ?? CHECKS[checkName].config.vl, // 读取配置时为空则回退到检测项默认阈值
                cooldown: this.api.config.get(`checks.${checkName}.cooldown`) ?? CHECKS[checkName].config.cooldown, // 读取配置时为空则回退到检测项默认冷却
                sound: this.api.config.get(`checks.${checkName}.sound`) ?? CHECKS[checkName].config.sound // 读取配置时为空则回退到检测项默认音效开关
            };
        }
    }

    /**
     * 执行单个手持物品检测项的公共逻辑
     */
    runAntiItemCheck(player, checkName, config, detectionRule) {
        if (!config.enabled) {
            player.lastAntiItemStates[checkName] = false; // 配置关闭后立即清理命中状态，避免重新开启时串状态
            this.reduceViolation(player, checkName, player.violations[checkName]);
            return;
        }

        const detectionInfo = this.resolveAntiItemDetection(player, detectionRule);
        const isTrackedItem = detectionInfo !== null;
        const wasTrackedItem = Boolean(player.lastAntiItemStates[checkName]);

        if (isTrackedItem && !wasTrackedItem) {
            player.lastAntiItemStates[checkName] = true; // 仅在切入目标物品时提醒一次
            this.logAntiItemDetection(player, detectionInfo); // 调试模式下输出本次手持物品检测的详细信息
            this.addViolation(player, checkName, config.vl || 1); // 单次切换事件应直接达到当前阈值，否则默认 VL 下不会告警

            if (this.shouldAlert(player, checkName, config)) {
                const customMessage = this.formatAntiItemAlert(player, detectionInfo);
                const plainText = `Warn: ${this.getPlainTeamTag(player)} ${this.getCleanPlayerName(player)} has ${detectionInfo.alertLabel}`; // 纯文本只保留一份队伍标识，避免和展示名前缀重复
                this.flag(player, checkName, player.violations[checkName], {
                    customMessage,
                    plainText,
                });
                this.markAlert(player, checkName);
            }
            return;
        }

        if (!isTrackedItem) {
            player.lastAntiItemStates[checkName] = false; // 切离目标物品后恢复可再次提醒状态
            this.reduceViolation(player, checkName, player.violations[checkName]); // 切离目标物品后重置违规值，避免累计污染下一次检测
        }
    }

    /**
     * 解析当前手持物品是否满足单个 AntiItem 检测项的条件
     */
    resolveAntiItemDetection(player, detectionRule) {
        const itemId = player.getItemId();
        if (itemId === null) {
            return null;
        }

        if (itemId !== detectionRule.itemId) {
            return null;
        }

        if (typeof detectionRule.matcher === 'function' && !detectionRule.matcher(player.heldItem)) {
            return null; // 允许某些物品继续追加细粒度判定，例如隐身药水 NBT 效果
        }

        return {
            itemId,
            alertLabel: detectionRule.alertLabel,
        };
    }

    /**
     * 判断当前药水物品是否包含隐身效果
     */
    isInvisibilityPotion(heldItem) {
        const customPotionEffects =
            heldItem?.nbtData?.value?.CustomPotionEffects?.value?.value;

        if (!Array.isArray(customPotionEffects)) {
            return false;
        }

        return customPotionEffects.some((effect) => effect?.Id?.value === 14);
    }

    /**
     * 格式化 AntiItem 的彩色告警消息
     */
    formatAntiItemAlert(player, detectionInfo) {
        const teamInfo = this.getTeamDisplayInfo(player);
        const itemColor = this.getAntiItemAlertColor(detectionInfo.alertLabel);

        return `§6Warn§7: ${teamInfo.playerColor}[${teamInfo.letter}] ${teamInfo.playerColor}${teamInfo.playerName} §7has ${itemColor}${detectionInfo.alertLabel}`; // 冒号和 has 统一改为灰色
    }

    /**
     * 为 AntiItem 告警提供队伍字母和玩家颜色
     */
    getTeamDisplayInfo(player) {
        const cleanName = this.getCleanPlayerName(player);
        const team = this.api.getPlayerTeam(cleanName);
        const prefix = team?.prefix || '';
        const letter = this.getTeamLetter(prefix) || 'W';
        const playerColor =
            TEAM_COLOR_MAP[letter] ||
            this.extractLastColorCode(prefix) ||
            this.extractLastColorCode(player.displayName) ||
            '§f'; // 优先按队伍字母固定映射颜色，避免被后缀或重置码干扰

        return {
            letter,
            playerColor,
            playerName: cleanName,
        };
    }

    /**
     * 返回 AntiItem 告警里物品标签对应的颜色
     */
    getAntiItemAlertColor(alertLabel) {
        if (alertLabel === 'OB') return '§5';
        if (alertLabel === 'invs Pot') return '§d';
        if (alertLabel === 'Pearl') return '§5';
        return '§7';
    }

    /**
     * 从带颜色代码的文本中提取最后一个颜色码作为玩家颜色
     */
    extractLastColorCode(text) {
        const normalizedText = String(text || '').replace(/&/g, '§').replace(/搂/g, '§'); // 兼容项目内可能出现的其他颜色码形式
        const matches = normalizedText.match(/§[0-9a-f]/gi);
        if (!matches || matches.length === 0) {
            return null;
        }

        return matches[matches.length - 1];
    }

    /**
     * 按项目内现有实现从队伍前缀中提取队伍字母
     */
    getTeamLetter(rawPrefix) {
        if (!rawPrefix) {
            return null;
        }

        const normalizedPrefix = String(rawPrefix).replace(/&/g, '§').replace(/搂/g, '§');
        const match = normalizedPrefix.match(/[A-Z]/);
        return match ? match[0] : null;
    }

    /**
     * 获取纯文本告警中使用的队伍标识前缀
     */
    getPlainTeamTag(player) {
        const teamInfo = this.getTeamDisplayInfo(player);
        return `[${teamInfo.letter}]`;
    }

    /**
     * 获取玩家的净化后名称
     */
    getCleanPlayerName(player) {
        return (
            player.username ||
            player.name ||
            this.stripColorCodes(player.displayName) ||
            'Unknown'
        );
    }

    /**
     * 获取告警中展示的玩家名，可选是否移除颜色代码
     */
    getAlertDisplayName(player, stripColors = false) {
        const cleanName = this.getCleanPlayerName(player);

        const team = this.api.getPlayerTeam(cleanName);
        const prefix = team?.prefix || '';
        const suffix = team?.suffix || '';
        const displayName = prefix + cleanName + suffix;

        return stripColors ? this.stripColorCodes(displayName) : displayName;
    }

    /**
     * 在调试模式下记录 AntiItem 命中时的详细上下文
     */
    logAntiItemDetection(player, detectionInfo) {
        const detailPayload = {
            timestamp: new Date().toISOString(),
            playerName: this.getAlertDisplayName(player, true),
            itemId: detectionInfo.itemId,
            itemLabel: detectionInfo.alertLabel,
            heldItem: player.heldItem,
        };

        this.api.debugLog(`[AntiItem DEBUG] ${JSON.stringify(detailPayload)}`);
    }

    /**
     * 重置单个玩家所有检测项的运行时状态
     */
    resetPlayerCheckRuntimeState(player) {
        for (const checkName of Object.keys(CHECKS)) {
            player.violations[checkName] = 0; // 切图或跨局时清空所有 VL，避免旧局数据影响新局
            player.lastAlerts[checkName] = 0;
        }

        player.noSlowData = null;
        player.swingHistory = [];
        player.lastSwingDetected = 0;
        player.towerData = null;
        player.lastAntiItemStates = {};
        player.shiftEvents = [];
        player.currentShiftStart = null;
        player.lastCrouchTime = 0;
        player.lastStopCrouchTime = 0;
        player.lastUsing = false;
        player.isBlocking = false;
        player.blockingStartTime = 0;
    }

    /**
     * 重置所有已追踪玩家的检测运行时状态
     */
    clearAllTrackedCheckState() {
        for (const [, player] of this.playersByUuid) {
            this.resetPlayerCheckRuntimeState(player);
        }
    }

    /**
     * 返回所有手持物品检测项名称
     */
    getAntiItemCheckNames() {
        return [
            'AntiItemObsidian',
            'AntiItemInvisibilityPotion',
            'AntiItemEnderPearl'
        ];
    }
    
    registerHandlers() {
        this.unsubscribeTick = this.api.everyTick(() => {
            for (const [uuid, player] of this.playersByUuid) {
                if (player.swingProgress > 0) {
                    player.swingProgress = Math.max(0, player.swingProgress - 1);
                }
            }
        });

        this.unsubscribePluginRestored = this.api.on('plugin_restored', (event) => {
            if (event.pluginName === 'anticheat') {
                this.refreshConfigConstants(); // 插件恢复时同步最新配置，避免 UI 修改后仍读取旧缓存
                this.reset();
            }
        });

        this.unsubscribeConfigChanged = this.api.on('config_changed', () => {
            this.refreshConfigConstants(); // 配置变更后刷新缓存，确保开关即时生效
        });

        this.unsubscribeEntityMove = this.api.on('entity_move', (event) => {
            if (event.isPlayer && event.entity) {
                this.handleEntityMove(event);
            }
        });
        
        this.unsubscribeEntityAnimation = this.api.on('entity_animation', (event) => {
            if (event.isPlayer && event.entity) {
                this.handleEntityAnimation(event);
            }
        });
        
        this.unsubscribePlayerJoin = this.api.on('player_join', (event) => {
            this.handlePlayerJoin(event);
        });
        
        this.unsubscribePlayerLeave = this.api.on('player_leave', (event) => {
            this.handlePlayerLeave(event);
        });
        
        this.unsubscribeRespawn = this.api.on('respawn', () => {
            this.reset();
        });
        
        this.unsubscribePlayerInfo = this.api.on('player_info', (event) => {
            this.handlePlayerListUpdate(event);
        });
        
        this.unsubscribeEntitySpawn = this.api.on('named_entity_spawn', (event) => {
            this.handlePlayerSpawn(event);
        });
        
        this.unsubscribeEntityDestroy = this.api.on('entity_destroy', (event) => {
            this.handleEntityRemove(event);
        });
        
        this.unsubscribeEntityMetadata = this.api.on('entity_metadata', (event) => {
            this.handleEntityMetadataFromEvent(event);
        });
        
        this.unsubscribeEntityEquipment = this.api.on('entity_equipment', (event) => {
            this.handleEntityEquipmentFromEvent(event);
        });
        
        this.unsubscribeEntityStatus = this.api.on('entity_status', (event) => {
            this.handleEntityStatusFromEvent(event);
        });
        
        this.unsubscribePosition = this.api.on('player_move', (event) => {
            if (event.player && event.player.isCurrentPlayer) {
                this.userPosition = event.position;
            }
        });
    }
    
    handleEntityMove(event) {
        if (!event.entity || event.entity.type !== 'player' || !event.entity.uuid) return;
        
        const playerInfo = this.api.getPlayerInfo(event.entity.uuid);
        const playerName = playerInfo?.name || this.uuidToName.get(event.entity.uuid) || 'Unknown';
        const displayName = this.uuidToDisplayName.get(event.entity.uuid) || playerName;
        
        const playerData = {
            name: playerName,
            uuid: event.entity.uuid,
            entityId: event.entity.entityId,
            displayName: displayName
        };
        
        const player = this.getOrCreatePlayer(playerData);
        if (!player) {
            return;
        }
        
        if (event.newPosition) {
            player.updatePosition(
                event.newPosition.x,
                event.newPosition.y,
                event.newPosition.z,
                true,
                event.rotation?.yaw,
                event.rotation?.pitch
            );
        } else if (event.delta) {
            const newX = player.position.x + event.delta.x;
            const newY = player.position.y + event.delta.y;
            const newZ = player.position.z + event.delta.z;
            
            player.updatePosition(
                newX,
                newY,
                newZ,
                event.onGround !== undefined ? event.onGround : player.onGround,
                event.rotation?.yaw,
                event.rotation?.pitch
            );
        }
        
        this.runChecks(player);
    }
    
    handleEntityAnimation(event) {
        if (!event.entity || event.entity.type !== 'player' || !event.entity.uuid) return;
        
        const playerInfo = this.api.getPlayerInfo(event.entity.uuid);
        const playerName = playerInfo?.name || this.uuidToName.get(event.entity.uuid) || 'Unknown';
        const displayName = this.uuidToDisplayName.get(event.entity.uuid) || playerName;
        
        const playerData = {
            name: playerName,
            uuid: event.entity.uuid,
            entityId: event.entity.entityId,
            displayName: displayName
        };
        
        const player = this.getOrCreatePlayer(playerData);
        if (!player) return;
        
        if (event.animation === 0) {
            player.swingProgress = 6;
            player.lastSwingTime = Date.now();
            player.lastSwingItem = player.heldItem;
        }
        
        this.runChecks(player);
    }
    
    handlePlayerJoin(event) {
        this.api.debugLog(`Player joined: ${event.player.name}`);
    }
    
    handlePlayerLeave(event) {
        if (event.player && event.player.uuid) {
            this.removePlayerByUuid(event.player.uuid);
        }
    }
    
    getOrCreatePlayer(playerData) {
        let player = this.playersByUuid.get(playerData.uuid);
        
        if (!player) {
            player = new PlayerData(playerData.name, playerData.uuid, playerData.entityId || -1);
            player.displayName = playerData.displayName || playerData.name;
            this.players.set(playerData.name, player);
            this.playersByUuid.set(playerData.uuid, player);
            if (playerData.entityId) {
                this.entityToPlayer.set(playerData.entityId, player);
            }
        } else {
            if (playerData.entityId && player.entityId !== playerData.entityId) {
                if (player.entityId !== -1) {
                    this.entityToPlayer.delete(player.entityId);
                }
                player.entityId = playerData.entityId;
                this.entityToPlayer.set(playerData.entityId, player);
            }
        }
        
        return player;
    }
    
    removePlayerByUuid(uuid) {
        const player = this.playersByUuid.get(uuid);
        if (player) {
            this.players.delete(player.username);
            this.playersByUuid.delete(uuid);

            for (const [entityId, p] of this.entityToPlayer) {
                if (p.uuid === uuid) {
                    this.entityToPlayer.delete(entityId);
                    break;
                }
            }
        }
    }
    
    handlePlayerListUpdate(event) {
        if (event.players) {
            event.players.forEach(update => {
                if (update.name && update.uuid) {
                    this.uuidToName.set(update.uuid, update.name);
                    this.uuidToDisplayName.set(update.uuid, update.displayName || update.name);
                }
            });
        }
    }
    
    handlePlayerInfo(data) {
        if (data.action === 0) {
            data.data.forEach(player => {
                if (player.name && player.UUID) {
                    this.uuidToName.set(player.UUID, player.name);
                    let displayName = player.name;
                    if (player.displayName) {
                        try {
                            const parsed = JSON.parse(player.displayName);
                            displayName = this.extractTextFromJSON(parsed);
                        } catch (e) {
                            displayName = player.displayName;
                        }
                    }
                    this.uuidToDisplayName.set(player.UUID, displayName);
                }
            });
        }
    }
    
    handlePlayerSpawn(event) {
        const data = event.player;
        
        const playerName = this.uuidToName.get(data.playerUUID) || 'Unknown';
        const displayName = this.uuidToDisplayName.get(data.playerUUID) || playerName;
        const player = new PlayerData(playerName, data.playerUUID, data.entityId);
        
        player.displayName = displayName;
        
        player.updatePosition(
            data.position.x,
            data.position.y,
            data.position.z,
            false
        );
        
        player.yaw = data.yaw;
        player.pitch = data.pitch;
        
        this.players.set(playerName, player);
        this.playersByUuid.set(data.playerUUID, player);
        this.entityToPlayer.set(data.entityId, player);
    }
    
    handleEntityRemove(event) {
        event.entities.forEach(entity => {
            const player = this.entityToPlayer.get(entity.entityId);
            if (player) {
                this.players.delete(player.username);
                this.playersByUuid.delete(player.uuid);
                this.entityToPlayer.delete(entity.entityId);
            }
        });
    }
    
    handleEntityMetadataFromEvent(event) {
        if (!event.entity || event.entity.type !== 'player') return;
        
        let player = this.entityToPlayer.get(event.entity.entityId);
        
        if (!player && event.entity.uuid) {
            const playerInfo = this.api.getPlayerInfo(event.entity.uuid);
            const playerName = playerInfo?.name || this.uuidToName.get(event.entity.uuid) || 'Unknown';
            const displayName = this.uuidToDisplayName.get(event.entity.uuid) || playerName;
            
            const playerData = {
                name: playerName,
                uuid: event.entity.uuid,
                entityId: event.entity.entityId,
                displayName: displayName
            };
            player = this.getOrCreatePlayer(playerData);
        }
        
        if (!player) return;
        
        if (event.metadata && Array.isArray(event.metadata)) {
            event.metadata.forEach(meta => {
                if (meta.key === 0 && meta.type === 0) {
                    const flags = meta.value;
                    const currentTime = Date.now();
                    
                    const wasCrouching = player.isCrouching;
                    player.isCrouching = !!(flags & 0x02);
                    
                    if (player.isCrouching && !wasCrouching) {
                        player.lastCrouchTime = currentTime;
                        player.currentShiftStart = currentTime;
                        player.shiftEvents.push({
                            type: 'start',
                            timestamp: currentTime,
                            position: { ...player.position }
                        });
                        
                        if (player.shiftEvents.length > 50) {
                            player.shiftEvents.shift();
                        }
                    } else if (!player.isCrouching && wasCrouching) {
                        player.lastStopCrouchTime = currentTime;
                        const duration = player.currentShiftStart ? currentTime - player.currentShiftStart : 0;
                        player.shiftEvents.push({
                            type: 'stop',
                            timestamp: currentTime,
                            position: { ...player.position },
                            duration: duration
                        });
                        player.currentShiftStart = null;
                        
                        if (player.shiftEvents.length > 50) {
                            player.shiftEvents.shift();
                        }
                    }
                    
                    player.isSprinting = !!(flags & 0x08);
                    
                    const wasUsingItem = player.isUsingItem;
                    player.isUsingItem = !!(flags & 0x10);
                    
                    if (player.isUsingItem && !wasUsingItem && player.isHoldingSword()) {
                        player.isBlocking = true;
                        player.blockingStartTime = currentTime;
                    } else if (!player.isUsingItem && wasUsingItem) {
                        player.isBlocking = false;
                    }
                    
                    if (player.isUsingItem !== player.lastUsing) {
                        player.lastUsing = player.isUsingItem;
                    }
                }
            });
        }
        
        this.runChecks(player);
    }
    
    handleEntityEquipmentFromEvent(event) {
        if (!event.entity || !event.isPlayer) return;
        
        const player = this.entityToPlayer.get(event.entity.entityId);
        if (!player) return;
        
        if (event.slot === 0) {
            player.heldItem = event.item; // 记录当前手持物品，供 AntiItem 等检测使用
            this.runAntiItemChecks(player); // 切换手持物品时仅触发手持物品检测，避免顺带执行所有检测项
        }
    }
    
    handleEntityStatusFromEvent(event) {
        if (!event.entity) return;
        
        const player = this.entityToPlayer.get(event.entity.entityId);
        if (!player) return;

        if (event.status === 2) {
            player.lastDamaged = Date.now();
        }
    }
    
    /**
     * 执行已启用的检测项，使用配置缓存避免高频事件反复读取配置
     */
    runChecks(player) {
        for (const checkName of Object.keys(CHECKS)) {
            const checkConfig = this.CONFIG[checkName]; // 高频移动和状态事件只读取配置缓存
            if (!checkConfig || !checkConfig.enabled) continue;
            
            const checkDefinition = CHECKS[checkName];
            if (checkDefinition && checkDefinition.check) {
                checkDefinition.check.call(this, player, checkConfig);
            }
        }
    }

    /**
     * 仅执行手持物品相关检测，避免装备切换事件触发整套检测逻辑
     */
    runAntiItemChecks(player) {
        const antiItemCheckNames = this.getAntiItemCheckNames();

        for (const checkName of antiItemCheckNames) {
            const checkConfig = this.CONFIG[checkName]; // 装备切换事件同样复用配置缓存
            if (!checkConfig || !checkConfig.enabled) {
                continue;
            }

            const checkDefinition = CHECKS[checkName];
            if (checkDefinition && checkDefinition.check) {
                checkDefinition.check.call(this, player, checkConfig);
            }
        }
    }
    
    /**
     * 发送检测告警并按配置播放提示音
     */
    flag(player, checkName, vl, options = {}) {
        this.api.debugLog(`[FLAG DEBUG] Player object:`, { 
            username: player.username, 
            name: player.name, 
            displayName: player.displayName,
            uuid: player.uuid
        });

        const displayName = this.getAlertDisplayName(player, false);
        const displayNameWithoutColor = this.getAlertDisplayName(player, true);

        this.api.debugLog(`Flagging ${displayName} for ${checkName} (VL: ${vl})`);

        const checkConfig = this.CONFIG[checkName] || CHECKS[checkName].config; // 告警阶段复用配置缓存，缺失时回退默认配置
        const alertsEnabled = checkConfig.enabled; // 使用缓存开关决定是否发送聊天告警
        if (alertsEnabled) {
            const alertBody = options.customMessage || `${displayName} §7flagged §5${checkName} §8(§7VL: ${vl}§8)`;
            const plainAlertText = options.plainText || `${displayNameWithoutColor} flagged ${checkName} (VL: ${vl})`;

            try {
                const messageComponent = {
                    text: `${this.api.getPrefix()} `,
                    extra: [
                        {
                            text: alertBody,
                            clickEvent: {
                                action: "suggest_command",
                                value: plainAlertText
                            },
                            hoverEvent: {
                                action: "show_text",
                                value: { text: "§8Click to paste in chat" }
                            }
                        }
                    ]
                };
                this.api.chat(messageComponent);
            } catch (_error) {
                this.api.chat(`${this.api.getPrefix()} ${alertBody}`);
            }
        }
        
        const soundEnabled = checkConfig.sound; // 使用缓存开关决定是否播放提示音
        if (soundEnabled) {
            this.api.sound('note.pling');
        }
    }
    
    cleanup() {
        if (this.unsubscribeTick) {
            this.unsubscribeTick();
        }
        if (this.unsubscribePluginRestored) {
            this.unsubscribePluginRestored();
        }
        if (this.unsubscribeConfigChanged) {
            this.unsubscribeConfigChanged();
        }
        if (this.unsubscribeEntityMove) {
            this.unsubscribeEntityMove();
        }
        if (this.unsubscribeEntityAnimation) {
            this.unsubscribeEntityAnimation();
        }
        if (this.unsubscribePlayerJoin) {
            this.unsubscribePlayerJoin();
        }
        if (this.unsubscribePlayerLeave) {
            this.unsubscribePlayerLeave();
        }
        if (this.unsubscribeRespawn) {
            this.unsubscribeRespawn();
        }
        if (this.unsubscribePlayerInfo) {
            this.unsubscribePlayerInfo();
        }
        if (this.unsubscribeEntitySpawn) {
            this.unsubscribeEntitySpawn();
        }
        if (this.unsubscribeEntityDestroy) {
            this.unsubscribeEntityDestroy();
        }
        if (this.unsubscribeEntityMetadata) {
            this.unsubscribeEntityMetadata();
        }
        if (this.unsubscribeEntityEquipment) {
            this.unsubscribeEntityEquipment();
        }
        if (this.unsubscribeEntityEffect) {
            this.unsubscribeEntityEffect();
        }
        if (this.unsubscribeRemoveEntityEffect) {
            this.unsubscribeRemoveEntityEffect();
        }
        if (this.unsubscribeEntityStatus) {
            this.unsubscribeEntityStatus();
        }
        if (this.unsubscribePosition) {
            this.unsubscribePosition();
        }
        this.reset();
    }
    
    extractTextFromJSON(jsonText) {
        if (typeof jsonText === 'string') {
            return jsonText;
        }
        
        let result = '';
        
        if (jsonText.text) {
            result += jsonText.text;
        }
        
        if (jsonText.extra && Array.isArray(jsonText.extra)) {
            for (const extra of jsonText.extra) {
                if (typeof extra === 'string') {
                    result += extra;
                } else if (extra.text) {
                    result += extra.text;
                }
            }
        }
        
        return result || 'Unknown';
    }

    stripColorCodes(text) {
        return String(text ?? '').replace(/(?:§|搂)[0-9a-fk-or]/gi, '');
    }
    
    addViolation(player, checkName, amount = 1) {
        if (player.violations[checkName] !== undefined) {
            player.violations[checkName] += amount;
        }
    }
    
    reduceViolation(player, checkName, amount = 1) {
        if (player.violations[checkName] !== undefined) {
            player.violations[checkName] = Math.max(0, player.violations[checkName] - amount);
        }
    }
    
    shouldAlert(player, checkName, config) {
        const hasViolations = player.violations[checkName] >= config.vl;
        const timeSinceLastAlert = Date.now() - player.lastAlerts[checkName];
        const cooldownPassed = timeSinceLastAlert > config.cooldown;
        
        return hasViolations && cooldownPassed;
    }
    
    markAlert(player, checkName) {
        if (player.lastAlerts[checkName] !== undefined) {
            player.lastAlerts[checkName] = Date.now();
        }
    }
}
