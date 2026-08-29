# BedWars Utilities（Starfish Proxy 插件）

一个用于 BedWars 的实用插件，提供自动查分与大厅辅助能力，减少手动操作。

## 项目来源

本项目基于以下仓库开发：

- [Grillekkj/BedWars-Utilities-a-Plugin-For-StafishProxy](https://github.com/Grillekkj/BedWars-Utilities-a-Plugin-For-StafishProxy)
- [UrchinGG/Starfish-Proxy](https://github.com/UrchinGG/Starfish-Proxy)

## 本项目主要改动

1. **`/bwu` 相关界面与提示汉化**  
   对 `bwu` 相关交互界面和提示信息进行了中文化处理。

2. **`autowho` 显示优化**  
   基于设定阈值（默认 `1 FKDR / 200 Star`）进行提示，在计算后的队伍数据后追加显示 `[追加信息]`。

3. **`denick` 交互优化**  
   点击 `denick` 警告时，会自动将相关信息粘贴到聊天输入栏，方便快速处理。

4. **增加自动更新配置项**  
   新增自动更新开关，可按需关闭自动更新功能。

5. **AutiCheat功能增加**
   允许检测玩家手持物品，当检测玩家切换invs，ob or pearl时，发送警报

6. **autofind功能优化**
   允许设置玩家星数阈值

## 功能概览

- 自动显示玩家核心数据：星数、FKDR、破床数、连胜等
- 赛前大厅发言自动查分
- 被提及时自动查分
- 自动执行 `/who` 并进行队伍威胁排序
- 按 FKDR 阈值自动重排队（Auto Requeue）
- 通过缓存降低 API 请求频率

## 快速开始

### 1. 安装插件

将以下内容放入 Starfish 的 `plugins` 目录：

- `bw-utilities-core-x-x-x.js`
- `bw-utilities-src` 文件夹

### 2. 配置 API Key

进入游戏后执行：

```text
/bwu setkey <NetherApi API Key>
/bwu setaurora <Aurora API Key>
```

### 3. 验证是否生效

- 输入 `/bwu` 查看命令列表
- 进入大厅后观察是否出现自动查分信息

## 常用命令

```text
/bwu
/bwu stats
/bwu setthreshold <value>
/bwu find
```

- `/bwu`：查看全部命令与当前可用选项
- `/bwu stats`：查询玩家数据
- `/bwu setthreshold <value>`：设置自动重排队阈值
- `/bwu find`：自动寻找 Lobby 1 组队

## 命令说明（全部）

以下命令均使用 `/bwu` 前缀。

### 基础与配置

- `/bwu`  
  查看可用子命令列表。

- `/bwu setkey <apikey>`  
  设置 NetherApi API Key。

- `/bwu setaurora <apikey>`  
  设置 Aurora API Key。

- `/bwu setthreshold <threshold>`  
  设置自动重排队 FKDR 阈值（需为 `>= 0` 的数字）。

- `/bwu ping`  
  显示当前 Ping。

- `/bwu clearstats`  
  清空当前已显示/管理的战绩数据。

- `/bwu rerank`  
  强制重新触发 `/who`，刷新队伍威胁排行与 Tab 战绩。

- `/bwu setinparty <true|false>`  
  手动设置 `inParty` 状态（调试命令）。

- 自动更新说明  
  自动更新为配置项 `updater.checkOnStartup`，当前版本没有单独的 `/bwu` 开关命令。

### 查分与对局

- `/bwu stats <nickname>`  
  查询指定玩家战绩。

- `/bwu allstats [color] [sendTo]`  
  显示当前追踪到的全部玩家战绩。  
  `color` 可选：`red|blue|green|yellow|aqua|white|pink|gray`  
  `sendTo` 可选：`private|team|party`（默认 `private`）

- `/bwu gamestats`  
  显示当前对局实时统计。

- `/bwu playerstats <player>`  
  显示当前对局指定玩家实时统计。

- `/bwu gametab [setting] [value]`  
  配置 Tab 对局统计显示。  
  `setting` 可选：`on|off|kills|deaths|fk|bb|delay`  
  当 `setting=delay` 时，`value` 必须在 `5-10`（秒）。  
  不带参数时显示当前配置。

### 组队招募（Find）

- `/bwu find <mode> <playersToFind> <fkdrThreshold> <starsThreshold> [positions...]`  
  自动招募队友。  
  `mode`：`2|3|4`  
  `playersToFind`：`1|2|3`，且必须小于 `mode`  
  `fkdrThreshold`：最低 FKDR  
  `starsThreshold`：最低 BedWars 星数  
  `positions`：可选招募附加信息；多个参数会合并为空格分隔的一条固定信息（如 `rush def`）

- `/bwu find stop`  
  停止自动招募。

### 队列消息（Queue Dodge）

- `/bwu setqdmsg <slot> <message...>`  
  保存队列消息到槽位 `1-5`。  
  省略 `message` 时会清空该槽位。

- `/bwu listqdmsg`  
  查看所有队列消息槽位。

- `/bwu qdmsg <slot>`  
  发送指定槽位消息（发送到 `/ac`）。

### Sniped 消息

- `/bwu setsniped <slot> <message...>`  
  保存 sniped 消息到槽位 `1-5`。  
  省略 `message` 时会清空该槽位。

- `/bwu listsniped`  
  查看所有 sniped 消息槽位。

- `/bwu sniped <slot> [ac]`  
  发送指定 sniped 消息。  
  默认走 `/shout`（带冷却排队）；传 `ac` 则走 `/ac`。

### 宏命令

- `/bwu setmacro <name> <content...>`  
  新建/覆盖宏。

- `/bwu delmacro <name>`  
  删除宏。

- `/bwu macros`  
  查看所有宏。

- `/bwu m <name>`  
  执行宏。

### 名称历史

- `/bwu mcnames <ign>`  
  查询玩家历史名称（含当前名称与 UUID）。

## 使用建议

- 先完成 API Key 配置，再使用自动查分功能
- 阈值可从较高值开始，按实战体验逐步调整
