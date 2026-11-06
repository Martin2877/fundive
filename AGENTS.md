# DeepLog 深蓝手账 · 在线潜水模拟

写实向潜水模拟与手账（原名 FunDive，包名 @fundive/* 保持不变）：Three.js 3D 潜水，目前含洞潜，
海潜/冰潜规划中；单人/多人联机、拍照图鉴、平行宇宙（种子化随机世界）、真实事件改编地图。

## 双语（i18n）

- `shared/i18n.js`：`t('中文原文', {参数})`，英文走 `shared/lang_en.js` 字典（key = 中文原文，缺词回落中文）。
- Talker.say / HUD.hint / setLineInfo 自动过 `t()`；带变量的文案必须写成 `t('…{x}…', {x})`，不要拼模板字符串。
- 地图/物种/结局等数据本体保持中文，展示时过 `t()` / `mapName()` / `spName()`。
- 新增任何中文文案后跑 `npm run i18n`，缺词会列出；`npm test` 含该检查。
- 语言存 localStorage `fundive.v1` 的 settings.lang，右上角按钮切换（回菜单时、会 reload）。

## 命令

```bash
npm install        # 装依赖（workspaces: client/server/shared）
npm run dev        # 开发：vite(5173) + 服务器(8790) 一起起
npm run build      # 构建 client -> client/dist
npm start          # 生产：8790 端口托管 dist + /ws 联机
# 静态部署（Cloudflare Pages 等）：build=npm run build, output=client/dist, Node20
#   联机 ws 端点 = 构建期 VITE_WS_URL，未配置走同源 /ws（静态托管时组队自动回落单机）
npm run smoke      # 冒烟测试：宇宙生成确定性 + ws 协议全流程
npm test           # worldtest（世界生成/碰撞与可见洞壁一致性）+ smoke + i18n 覆盖检查
npm run i18n       # 列出缺英文翻译的中文字符串
npm run shots      # 画面验收：全地图截图 + 亮度/过曝/帧率/报错门禁（需先 npm run dev，本机 Chrome）
node scripts/worldtest.mjs  # 世界生成/碰撞场测试（node + DOM stub）
node scripts/oceantest.mjs  # 海潜世界：海底/沉船碰撞、锚绳、节点
node scripts/icetest.mjs    # 冰潜世界：冰盖挡顶、冰洞出口、安全绳、生物布点
node scripts/surfprobe.mjs  # 出水流程探针（playwright，需 dev）：出口→水面世界→接应
node scripts/flowprobe.mjs  # 海流探针 --map=N：激流/暗流/洗衣机区漂移 + G 挂钩
node scripts/landprobe.mjs  # 气室干岸探针：上岸走动/回水
node scripts/exitprobe.mjs  # 非常规出口探针：第二洞口/攀爬/呼救三结局
node scripts/compassprobe.mjs # 罗盘课节探针：bearing 检查 + HUD 罗盘条
```

## 结构

- `shared/` — 双端共用：种子RNG(rng.js)、地图数据(maps.js，真实事件改编)、
  平行宇宙生成(universe.js)、联机协议(protocol.js)、物种/结局图鉴数据、
  教学课程(courses.js，OW/AOW/军队课节与考核步骤)
- `client/` — Vite + Three.js：
  - `src/engine/` 洞穴网格放样+碰撞场(cave.js)、海潜开阔水(ocean.js)、
    冰潜冰盖湖(ice.js)、海洋生物(marine.js)、水下氛围(water.js)、
    泥沙系统(silt.js)、生物生成(creatures.js)、潜水员模型(diver.js)、噪声(noise.js)
  - `src/game/` 会话总控(session.js)、玩家物理+生理(player.js)、AI潜伴(buddy.js)、
    目标系统(objective.js)、拍照(photo.js)、联机(netplay.js)、输入(input.js)、
    程序化音频(audio.js)、localStorage持久化(storage.js)、
    教学会话+考核引擎(training.js，TrainingSession 继承 DiveSession)
  - `src/ui/` 菜单/大厅/计划/结算/图鉴/课程表(screens.js)、HUD+键位表(hud.js)
- `server/` — Node + ws：静态托管 + 房间/大厅/位姿转发（rooms.js）

## 支洞与气室

maps.js 的 branches 支持 `pocket`(尽头气室,配 endR)、`bottomless`(无底/未探明竖井)、`deadEnd`、
`to`(回环：末端接回主线节点，配 `kind:'loop'` 播报回环提示)；
主路线节点 feats 含 `pocket` 也会生成气室。cave.js `addDome` 生成水线面+`pockets`(含 waterY/bad)，
player.js 判 `inAir`：不耗气、惊慌下降；bad 气室(20%,种子决定)不能呼吸。气室里气<60 停留 25s -> `rescued` 结局。
session 进入支洞 4m 内提示并记 `branch` 事件(进回放/结算)。

## 生物与图鉴

SPECIES 每项含 rarity/desc/hint/tip(识别要点)；新增 8 种(溪鳟/洞螈/螯虾/洞螺/铁细菌/石膏花/流石幔/兽骨)，渲染在 creatures.js。
图鉴按类别筛选、显示稀有度/拍摄数/出没地。教学课程 `nat`(洞穴生物学家)用隐藏地图 `lab`(LAB_SPECIES 每节点一个物种)，
步骤 `teach:sp` 讲识别要点，`photo` 检查可带 `sp` 指定物种；步骤标签带 `lp` 占位参数，展示用 `tl()`。

## 海潜

maps.js 中 `kind:'ocean'` 的地图（reef/wreck/bluewall）走 `engine/ocean.js`（高度场海底 + 可穿行沉船碰撞箱 + 潜水船/锚绳 + 实例化珊瑚礁石），
接口与 `buildCave` 同形（nav.clamp/closest、nodes、mainSpine、linePts…），由 `engine/world.js` 分发；生物走 `engine/marine.js`。
route 节点 `p:[x, 离海底高度, z]`（`abs:true` 绝对 y，`surface:true` 水面，`ref:'wreck'` 相对沉船中心）。
出水点 = 潜水船周围 10m 水面；上升建议抓锚绳(G)。`scripts/oceantest.mjs` 校验海底/沉船碰撞与节点。
- **SMB 浮标**：C 键（3m 以下才放得出）。浮标出水后，离船 >10m 上浮 4.5s 判 `boat_pickup`（好结局）；
  无浮标漂在远处水面 45s 判 `adrift`。水面空瓶不判气尽改漂浮（player.noGas）。
- 沉船：舰桥是空心海图室（前壁门洞进），货舱有集装箱/卡车/油桶内景（碰撞同墙）；节点 8 = 海图室。
- 教学课 `ocn` 用 reef/wreck 图；check `pickup` 由 TrainingSession._finish 拦截 boat_pickup 驱动。

## 剧情与支线

`shared/story.js`：每张洞穴图一章(title/briefing/beats/epilogue/notes)。beats 走到节点或目标完成时由 session 播报；
通关(活着 + 目标完成)记 `store.chapters`，菜单地图卡显示 ✓。`STORY_VARS` + `storyOf(mapId, uni)`：同一章在
不同宇宙里用不同简报/尾声（uni.storyVar 0=原版，1/2=变体）。支线机缘 `uni.sides`(手记/遗落物/求助潜水员，独立随机流)，
由 `game/sidequest.js` 生成并响应 E；手记进图鉴「前人手记」页(store.lore)。

## 复盘回放

session.js 每 0.5s 采样轨迹 `[t,x,y,z,gas,ascRate]` 并把 talk/emit 事件记入时间轴，结算时放进 `result.replay`；
`ui/replay.js` 画俯视路线 + 深度剖面，支持拖动/倍速。

## 教学模式

主菜单「教学课程」-> 课程表 -> 下水考核。课节=步骤序列，每步一个 check
（key/hold/combo/mask/maskwater/depth/reach/deploy/gesture/rand_gesture/buddy/
ccr/ascend/photo/exit/wait/say/lightoff），见 courses.js 注释。
新键位：M 面镜 · H 压上沿 · N 鼻吐气 · X 捏鼻 · R 二级头 · B/V BCD · K 蛙踢 ·
O CCR · Tab 键位表。教学地图 pool/harbor 带 hidden 标记不进选图。
e2e：`node scripts/e2e_train.mjs --url=http://localhost:5173`（需先 npm run dev）。

## 画面开发规范

画面/体验设计与验收流程见 `docs/DESIGN.md`。改动渲染相关代码后必须跑 `npm test` 与 `npm run shots`（三档画质：`-- --quality=low|mid|high`），并人工看 `reports/shots/`。

## 核心设计

- **平行宇宙**：(mapId, seed) -> `makeUniverse` 确定性生成目标/布点/修饰。
  世界本体不走网络同步——联机只传位姿与事件，天然防作弊且省带宽。
- **碰撞**：走廊约束——玩家到骨架线段的距离不得超过该段半径，不做网格碰撞。
- **生理**：气量(深度×活动耗气)、免减压表插值、氮醉(>24m 起，>0.82 计时判死、
  移动中变慢)、惊慌、上升限速(>0.5m/s 欠减压债、>1.0m/s 持续4s判减压病、
  G抓绳爬升自动限速0.45m/s)、氧中毒(>65m 确定性暴露计时)、
  卡缝、泥沙迷路、断线迷路、自由流、灯故障——全部触发对应"结局"。
- **目标类型**：explore 标记石 / photo 指定物种拍摄 / salvage 打捞负重 / rescue 拖带被困者 / survey 巡线标记（沿主线摸 3 处标记石）。
- **随机事件**：`uni.events` 由宇宙种子排定时刻表（rumble 洞鸣震屏 / rockfall 落石扬尘 /
  surge 临时激流 / flicker 灯闪 / shoal 鱼群横穿 / omen 氛围凶兆 / thermocline 温跃层 /
  creak+cold_snap 冰下专属），session `_fireEvent` 一次性触发；OMENS 文案池在 story.js。
- **拍照**：F 开取景器再按 F 拍摄；按主体居中度+距离+光照评 1-3 星，进图鉴(localStorage)。

## 操作

WASD 游动 · 鼠标视角(点击画面锁定) · 空格快踢(搅沙) · K 蛙踢 · F 拍照 ·
E 互动 · G 抓引绳 · Q 备用二级头 · L 主灯 · M 面镜 · H 压上沿 · N 鼻吐气 ·
X 捏鼻 · R 二级头 · B/V BCD充放气 · O CCR · C 浮标(海潜SMB) · I/U 手动吸呼气 ·
1-5 手势 · Tab 键位表 · Esc 暂停。移动端：左半屏落指浮动摇杆、右半屏拖视角；右下 3×3 常驻钮
（快踢/蛙踢/充放气/灯/拍照/抓绳/互动/装备），次要动作与手势收在「装备」抽屉；
触屏按钮模拟真实键码进 keys/presses，教学考核与组合技(H+N/X+N)与键盘同源；
小屏触屏不画面镜框、不建体感小人，暂停/键位在右缘中部。

## 其他机制

- 体感小人（ui/avatar.js）：左下角 3D 视窗实时呈现俯仰/踢水/BCD鼓瘪/手持面镜/手臂动作/侧挂瓶。
- 面镜框（hud.js `_makeMaskFrame`）：潜水中视野外圈的硅胶镜框，摘镜即消失。
- 手动呼吸：暂停菜单切换；I 吸 / U 呼，肺量影响浮力，硬憋涨惊慌。
- BCD 浮力=持续加速度（player.js：垂直方向独立阻尼与限速），碰撞只消法向速度。
