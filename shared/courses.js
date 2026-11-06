// 教学课程数据 — OW / AOW / 军队潜水。
// 课程 course：{ id, name, en, desc, kit, lessons[] }
// 课节 lesson：{ id, name, brief, map, seed?, ccr?, buddy?, start?{node,y}, intro, steps[] }
// 步骤 step：{ label, key?, coach?, timeout?, strict?, check }
// check 类型：
//   say                    纯解说，dur 秒
//   key {code}             点按某键
//   hold {code,min}        按住某键 min 秒（连续）
//   combo {codes[],min}    多键同按 min 秒
//   mask {on}              面镜戴上/摘下
//   maskwater {max}        面镜水位低于 max
//   depth {at,tol,hold}    在 at±tol 米悬停 hold 秒
//   reach {node,d,dark?}   抵达路线节点（dark: 开灯计失误）
//   deploy {node}          到节点旁按 E 布放装置
//   gesture {want}         打指定手势（1-5）
//   rand_gesture {n}       随机手势/事件应答 n 次（运行时展开）
//   buddy {d}              靠近潜伴 d 米内
//   ccr {n}                应答 n 次 PO2 报警（按 O）
//   ascend {to,rate}       以 ≤rate m/s 上升到 to 米
//   photo {min}            拍一张 ≥min 星的照片
//   exit                   回到出口水面
//
// 键位约定（也见键位表 Tab）：
//   M 面镜摘/戴 · H 压面镜上沿 · N 鼻子吐气 · X 捏鼻 · R 二级头拿开/含回
//   B BCD充气 · V BCD放气 · K 蛙踢 · O CCR氧电池检查 · 1-5 手势

export const GESTURE_KEYS = { ok: '1', up: '2', help: '3', line: '4', light: '5' };

// 随机事件池：教练给情景 -> 你回手势。want 对应 1-5。
export const GESTURE_EVENTS = [
  { text: '教练在你对面比了个 OK —— 问你「还好吗」', want: 'ok',    reply: '你回了个 OK' },
  { text: '教练敲敲自己的气瓶，指指上面',             want: 'up',    reply: '你指了指上面：收到，准备撤' },
  { text: '（演练）你突然呛水 —— 用手势叫教练过来',   want: 'help',  reply: '你猛挥手求助，教练一把按住你' },
  { text: '教练做了个「线呢」的摊手动作',             want: 'line',  reply: '你指了指引绳的位置' },
  { text: '远处潜伴的灯闪了三下 —— 用灯回他',         want: 'light', reply: '你把灯上下晃了两下回应' },
  { text: '一条洞鲶从泥沙里窜出来，教练示意你注意',   want: 'light', reply: '你用灯圈出那条鱼：看见了' },
  { text: '教练比了个问号 —— 一切正常吗',             want: 'ok',    reply: '你比了个 OK' },
  { text: '（演练）你看到队友往岔洞深处游去 —— 提醒他', want: 'help', reply: '你朝他挥灯打手势：回来' },
];

const P = 'pool', H = 'harbor';

// 生物课节：逐个物种「走到跟前 -> 听教练讲识别要点 -> 拍下来」。labelParams.sp 为物种中文名，展示时再本地化。
const speciesSteps = (list) => list.flatMap((sp) => {
  const node = LAB_SPECIES.indexOf(sp) + 1;
  return [
    { label: '游到「{sp}」附近', lp: { sp: SPECIES[sp].name }, check: { t: 'reach', node, d: 5 }, timeout: 120 },
    { label: '拍下「{sp}」', lp: { sp: SPECIES[sp].name }, key: 'F × 2', teach: sp, check: { t: 'photo', min: 1, sp }, timeout: 120 },
  ];
});
const natLesson = (id, name, brief, intro, list) => ({
  id, name, map: 'lab', brief, intro, start: { node: LAB_SPECIES.indexOf(list[0]) }, steps: speciesSteps(list),
});

import { SPECIES, LAB_SPECIES } from './maps.js';

export const COURSES = [
  {
    id: 'ow', name: 'OW 开放水域潜水员', en: 'Open Water',
    desc: '平静水域六课。每个动作拆到按键级：按对了、按够时长、顺序对，才算过。',
    kit: '面镜 · 蛙鞋 · BCD · 单瓶空气 · 主灯',
    lessons: [
      {
        id: 'ow_ready', name: '装备检查与入水', map: P,
        brief: '下水前的五分钟决定下水后的五十年。',
        intro: '我是你的教练。先做行前检查，然后我们下到三米平台。',
        steps: [
          { label: '听教练讲话', check: { t: 'say', dur: 4 }, coach: '水面以上把事做完，水面以下就没有事。' },
          { label: '调出键位表看一眼', key: 'Tab', check: { t: 'key', code: 'Tab' }, coach: '忘了哪个键干什么，随时按 Tab。' },
          { label: '关掉键位表', key: 'Tab', check: { t: 'key', code: 'Tab' } },
          { label: 'BCD 充气测试', key: 'B 按住', check: { t: 'hold', code: 'KeyB', min: 1.0 }, coach: '按 B 给 BCD 打点气，听它嘶一声。' },
          { label: 'BCD 放气测试', key: 'V 按住', check: { t: 'hold', code: 'KeyV', min: 1.0 }, coach: '再按 V 放掉。' },
          { label: '主灯开关', key: 'L', check: { t: 'key', code: 'KeyL' }, coach: '灯开一下确认亮。' },
          { label: '下潜到 3 米', key: 'S / 俯身游 · B/V 微调', check: { t: 'depth', at: 3, tol: 0.9, hold: 1.5 }, coach: '跟我下去，三米平台，别急。飘了就点按 B/V 微调。' },
          { label: '做一次耳压平衡', key: 'X+N 长按', check: { t: 'combo', codes: ['KeyX', 'KeyN'], min: 1.2 }, coach: '捏住鼻子（X）轻轻鼓气（N）。耳膜比面子值钱。' },
        ],
      },
      {
        id: 'ow_mask', name: '面镜排水', map: P,
        brief: 'OW 劝退第一名。其实就是一个按住吐气的动作。',
        intro: '接下来摘面镜。会呛，但呛不死……呛不着。我在。',
        start: { node: 1, y: -3 },
        steps: [
          { label: '听教练讲解', check: { t: 'say', dur: 5 }, coach: '顺序是：摘 → 戴 → 压上沿 → 鼻子长吐气。气从鼻子走，水从裙边出。' },
          { label: '摘下面镜', key: 'M', check: { t: 'mask', on: false }, strict: true, coach: '按 M 摘面镜。睁着眼，看着我。' },
          { label: '在水里睁着眼待 3 秒', check: { t: 'wait', s: 3 }, coach: '看见气泡往哪走了吗？那是"上"。' },
          { label: '戴回面镜', key: 'M', check: { t: 'mask', on: true }, strict: true, coach: '戴回去。现在面镜里全是水，别急着吐。' },
          { label: '压上沿 + 鼻子长吐气', key: 'H+N 同按 ≥2.6s', check: { t: 'combo', codes: ['KeyH', 'KeyN'], min: 2.6 }, strict: true, coach: '按住 H 压住面镜上沿，同时 N 用鼻子慢慢吐气——气往下压，水从下沿出去。' },
          { label: '面镜水排干净', check: { t: 'maskwater', max: 0.12 }, coach: '水位降下去就停。没排干净就再压一次 H+N。' },
          { label: '给教练比 OK', key: '1', check: { t: 'gesture', want: 'ok' }, coach: '成了。比个 OK。' },
        ],
      },
      {
        id: 'ow_reg', name: '调节器脱落与排水', map: P,
        brief: '二级头掉了不慌：找回、含回、吐气排水。',
        intro: '这次练二级头。掉了别猛吸——先含回去，再把水吐出去。',
        start: { node: 1, y: -3 },
        steps: [
          { label: '听教练讲解', check: { t: 'say', dur: 4 }, coach: '二级头掉了：手往右后摸，找回，含住，猛吐一口气把水排出去。' },
          { label: '拿开二级头', key: 'R', check: { t: 'key', code: 'KeyR' }, strict: true, coach: '按 R 把它拿开。开始憋气了，动作快点。' },
          { label: '含回二级头', key: 'R', check: { t: 'key', code: 'KeyR' }, timeout: 9, strict: true, coach: '找回，含回去！' },
          { label: '吐气排水', key: 'N 按住 ≥1.6s', check: { t: 'hold', code: 'KeyN', min: 1.6 }, strict: true, coach: '按住 N 猛吐一口——把水从排气阀顶出去。' },
          { label: '给教练比 OK', key: '1', check: { t: 'gesture', want: 'ok' } },
        ],
      },
      {
        id: 'ow_buoy', name: '中性浮力·悬停', map: P,
        brief: 'BCD 一口气一口气地调，直到你挂在水中不上不下。',
        intro: '好的潜水员不用手脚悬停。用 B（充气）V（放气）把自己调成一个气泡。',
        start: { node: 2, y: -4 },
        steps: [
          { label: '4 米深度悬停 5 秒', key: 'B / V 点按微调', check: { t: 'depth', at: 4, tol: 0.35, hold: 5 }, timeout: 40, coach: '把自己挂在四米。上下别超过半米。呼吸也能调浮力，慢吸慢呼。' },
          { label: '上浮到 2 米再悬停 4 秒', key: 'B / V', check: { t: 'depth', at: 2, tol: 0.3, hold: 4 }, timeout: 40, coach: '上浮两米，重新挂住。BCD 里的气会膨胀，记得边升边放。' },
          { label: '给教练比 OK', key: '1', check: { t: 'gesture', want: 'ok' }, coach: '稳了。这就叫中性浮力。' },
        ],
      },
      {
        id: 'ow_signal', name: '水下手势应答', map: P,
        brief: '水下没有语言，只有手。教练随机出题，随机打分。',
        intro: '我出情况，你回手势。回错了扣分，回慢了也扣分。',
        start: { node: 1, y: -3 },
        steps: [
          { label: '听教练讲解', check: { t: 'say', dur: 4 }, coach: '1=OK · 2=上升/撤 · 3=求助 · 4=指引绳 · 5=灯信号。注意看题。' },
          { label: '手势应答 ×6', key: '1-5', check: { t: 'rand_gesture', n: 6 } },
          { label: '听教练点评', check: { t: 'say', dur: 3 }, coach: '水下打手势要慢、要大、要对到人脸上。' },
        ],
      },
      {
        id: 'ow_ascent', name: '安全上升与停留', map: P,
        brief: '上升是整支潜水最危险的一段。慢，就是全部技术。',
        intro: '最后一课：从沙地沟底回水面。上升速度不许超过 0.25 m/s，五米停五秒，游回浅水平台再出水。',
        start: { node: 4, y: -7.5 },
        steps: [
          { label: '以 ≤0.25m/s 上到 5 米', key: 'B/V + 轻踢', check: { t: 'ascend', to: 5, rate: 0.25 }, timeout: 60, coach: '开始上升。看着深度表，气泡永远比你快，别追它。' },
          { label: '5 米安全停留 5 秒', check: { t: 'depth', at: 5, tol: 0.7, hold: 5 }, coach: '停住。让氮气慢慢离开你的血。' },
          { label: '沿通道游回浅水平台', key: 'WASD 慢游', check: { t: 'reach', node: 1, d: 3.5 }, timeout: 70, coach: '沟底这段顶不高，升不到水面——边游边放气，跟着浮标回浅水平台。' },
          { label: '继续缓慢升到 1.2 米', key: 'W 轻踢', check: { t: 'ascend', to: 1.2, rate: 0.25 }, timeout: 60, coach: '这里头顶就是水面。最后一段更要慢。' },
          { label: '出水', check: { t: 'exit' }, coach: '扶着边上去。课毕。' },
        ],
      },
    ],
  },
  {
    id: 'aow', name: 'AOW 进阶开放水域', en: 'Advanced OW',
    desc: '进阶五课：共生呼吸、导航、悬浮、蛙踢过沙、目标拍摄。',
    kit: '全套 OW 装备 · 备用二级头 · 线轮 · 相机',
    lessons: [
      {
        id: 'aow_share', name: '共生呼吸（借气）', map: P,
        brief: '潜伴没气了扑过来，你要在十秒内把备用二级头给他。',
        intro: '今天教练演倒霉蛋：他会比划"没气了"。顺序：他抓你 → 你按 E 递备用 → 你按 Q 换自己吸备用。',
        start: { node: 1, y: -3 },
        steps: [
          { label: '等潜伴游过来', check: { t: 'say', dur: 3 }, coach: '（教练比了个"割喉"——他没气了，朝你游过来）' },
          { label: '稳住他', check: { t: 'buddy', d: 2.2 }, coach: '让他靠近，别躲。' },
          { label: '递出备用二级头', key: 'E', check: { t: 'key', code: 'KeyE' }, timeout: 10, strict: true, coach: '按 E 把备用二级头塞给他！' },
          { label: '自己切到备用呼吸', key: 'Q', check: { t: 'key', code: 'KeyQ' }, timeout: 6, strict: true, coach: '你的主二级头给他吸，你按 Q 换备用！' },
          { label: '保持镇静呼吸 4 秒', check: { t: 'wait', s: 4 }, coach: '两个人，一只瓶。慢呼吸，别动。' },
          { label: '给教练比 OK', key: '1', check: { t: 'gesture', want: 'ok' }, coach: '他活下来了。你也活下来了。' },
        ],
      },
      {
        id: 'aow_nav', name: '水下导航', map: P,
        brief: '沿着三个浮标走一趟往返，别看引绳。',
        intro: '三个发光浮标标出一条折线。挨个游过去，别看绳——考的是你自己的方向感。',
        start: { node: 1, y: -3 },
        steps: [
          { label: '抵达 1 号浮标', check: { t: 'reach', node: 2, d: 2.4 }, coach: '第一个浮标在浅水平台方向。' },
          { label: '抵达 2 号浮标', check: { t: 'reach', node: 3, d: 2.4 }, coach: '下一个在深水沟口。' },
          { label: '抵达 3 号浮标', check: { t: 'reach', node: 4, d: 2.4 }, coach: '最后一个，沟底。' },
          { label: '返回浅水平台', check: { t: 'reach', node: 1, d: 3 }, coach: '原路摸回来。记路是潜水员的基本功。' },
          { label: '给教练比 OK', key: '1', check: { t: 'gesture', want: 'ok' } },
        ],
      },
      {
        id: 'aow_compass', name: '指北针导航', map: P,
        brief: '不看浮标不看绳——用头顶那条罗盘对准 ◆ 走到目标，再按方位走回来。',
        intro: '你腰上夹了个指北针：顶上的罗盘带是你的朝向（N北E东S南W西），◆ 是你该去的方向。先对准它，再游过去。',
        start: { node: 1, y: -3 },
        steps: [
          { label: '听教练讲解', check: { t: 'say', dur: 5 }, coach: '罗盘带上的刻度是朝向。◆ 永远指着目标方位——对准它，方向就对了。' },
          { label: '对准 ◆ 方向保持 3 秒', key: '鼠标转身', check: { t: 'bearing', node: 3, hold: 3 }, coach: '转身让游标和 ◆ 重合。别管鱼，别管绳，只认 ◆。' },
          { label: '沿 ◆ 游到浮标', check: { t: 'reach', node: 3, d: 2.6 }, timeout: 70, coach: '方向对了就游。罗盘会偏，时不时回来看一眼。' },
          { label: '对准回程 ◆ 保持 2 秒', check: { t: 'bearing', node: 1, hold: 2 }, coach: '现在 ◆ 指着来路。先对准，再动。' },
          { label: '按 ◆ 回到浅水平台', check: { t: 'reach', node: 1, d: 3 }, timeout: 70, coach: '走回去。能靠方位走个来回，才算真的会导航。' },
          { label: '给教练比 OK', key: '1', check: { t: 'gesture', want: 'ok' }, coach: '真水里罗盘就是你的命。' },
        ],
      },
      {
        id: 'aow_hover', name: '悬浮控制·进阶', map: P,
        brief: '误差从半米收到三十厘米。还能腾出一只手打手势才算稳。',
        intro: 'OW 让你挂住，AOW 让你挂稳：正负 0.3 米，六秒。',
        start: { node: 2, y: -4 },
        steps: [
          { label: '4 米悬停 ±0.3m 六秒', key: 'B/V 微调', check: { t: 'depth', at: 4, tol: 0.3, hold: 6 }, timeout: 45, coach: '更窄的窗口，更长的时间。呼吸是你的微调阀。' },
          { label: '悬停中给教练比 OK', key: '1', check: { t: 'gesture', want: 'ok' }, timeout: 20, coach: '别动深度，腾出一只手，比 OK。' },
          { label: '升到 2.5 米再挂 4 秒', key: 'B/V', check: { t: 'depth', at: 2.5, tol: 0.3, hold: 4 }, timeout: 40, coach: '换深度再挂一次。' },
        ],
      },
      {
        id: 'aow_frog', name: '蛙踢过沙地', map: P,
        brief: '自由泳踢法会把沙子搅成一堵墙。蛙踢（K）贴着地走，沙不扬。',
        intro: '前面是一段泥沙底。只能用蛙踢——按住 K 游过去。敢快踢（空格）就重来。',
        start: { node: 3, y: -6 },
        steps: [
          { label: '蛙踢穿过泥沙区', key: 'K 按住 + WASD', check: { t: 'reach', node: 4, d: 2.4, frog: true }, timeout: 60, coach: '蛙泳式收踢，动作小，频率慢。搅起一点沙都算我的。' },
          { label: '蛙踢返回', key: 'K', check: { t: 'reach', node: 3, d: 2.4, frog: true }, timeout: 60, coach: '再踢回来。回头看一眼：水还清的，说明你对了。' },
          { label: '给教练比 OK', key: '1', check: { t: 'gesture', want: 'ok' } },
        ],
      },
      {
        id: 'aow_photo', name: '目标拍摄考核', map: P,
        brief: '不是按 F 就算照片。居中、距离、光照都计分，拍到 2 星以上。',
        intro: '去大厅里找点会动或者不会动的东西，拍一张 ≥2★ 的。F 开取景器，再按 F 拍。',
        start: { node: 1, y: -3 },
        steps: [
          { label: '拍到一张 ≥2★ 照片', key: 'F × 2', check: { t: 'photo', min: 2 }, timeout: 90, coach: '主体放进框中间，灯照着，离近点再按。' },
          { label: '给教练比 OK', key: '1', check: { t: 'gesture', want: 'ok' }, coach: '这张能进图鉴了。' },
        ],
      },
    ],
  },
  {
    id: 'ocn', name: '海洋潜水员', en: 'Ocean Diver',
    desc: '下海三课：沿锚绳下去，放浮标上来，最后看一眼真正的沉船。海里没有顶——上升就是你的退路。',
    kit: 'OW 全套 · 水面浮标（SMB）· 相机',
    lessons: [
      {
        id: 'ocn_entry', name: '锚绳下潜与安全停留', map: 'reef',
        brief: '第一次下海：沿锚绳下去，悬停，拍照，再顺着它回来。',
        intro: '欢迎来到珊瑚花园。海里没有洞顶，但也没有墙——认路靠两样东西：水下的锚绳，水面的浮标。',
        start: { node: 1, y: -1.5 },
        steps: [
          { label: '听教练讲话', check: { t: 'say', dur: 5 }, coach: '潜伴把你送到锚点。沿绳下去，耳压早做勤做。' },
          { label: '沿锚绳下潜到 6 米', key: 'S 下潜 · 可抓绳（G）', check: { t: 'depth', at: 6, tol: 0.9, hold: 2 }, coach: '顺着锚绳往下——它从船底一直垂到海底。' },
          { label: '做一次耳压平衡', key: 'X+N 长按', check: { t: 'combo', codes: ['KeyX', 'KeyN'], min: 1.2 }, coach: '海里下得快，耳朵更要勤。' },
          { label: '游到「礁坪」', check: { t: 'reach', node: 2, d: 4 }, timeout: 90, coach: '锚点在身后，礁坪在前面。回头看一眼绳——记住它在哪。' },
          { label: '8 米悬停 4 秒', key: 'B/V 微调', check: { t: 'depth', at: 8, tol: 0.6, hold: 4 }, timeout: 45, coach: '别踩珊瑚。用脚蹼以外的东西碰礁盘，在海里和洞里一样丢人。' },
          { label: '拍一张 ≥1★ 照片', key: 'F × 2', check: { t: 'photo', min: 1 }, timeout: 90, coach: '礁坪上有的是模特。居中、灯照到、别贴脸。' },
          { label: '放出水面浮标', key: 'C', check: { t: 'key', code: 'KeyC' }, strict: true, coach: '按 C 放 SMB。橙色的球替你在水面上喊"我在这"。' },
          { label: '以 ≤0.3m/s 升到 3 米', key: 'B/V + 轻踢', check: { t: 'ascend', to: 3, rate: 0.3 }, timeout: 60, coach: '顺着你的浮标线往上走。慢。' },
          { label: '3 米安全停留 4 秒', check: { t: 'depth', at: 3, tol: 0.7, hold: 4 }, coach: '安全停留。海里的每一支深潜都以这三分钟收尾。' },
          { label: '游回潜水船出水', check: { t: 'exit' }, timeout: 90, coach: '抬头找船底，游回去。' },
        ],
      },
      {
        id: 'ocn_smb', name: '漂流与浮标接应', map: 'reef',
        brief: '故意离船远一点，然后让浮标替你把船叫来。',
        intro: '这一课练漂流接应：游到礁沿，放浮标，直接出水——船会来找你。记住：没有浮标，船找不到你。',
        start: { node: 1, y: -1.5 },
        steps: [
          { label: '听教练讲解', check: { t: 'say', dur: 5 }, coach: '漂流潜水不回锚绳：顺流潜完，打浮标，船来接。今天试一次。' },
          { label: '游到「礁沿」', check: { t: 'reach', node: 6, d: 5 }, timeout: 160, coach: '一路向北到礁沿。不用省回程的力气——船来接你。' },
          { label: '放出水面浮标', key: 'C', check: { t: 'key', code: 'KeyC' }, strict: true, coach: '深一点放，线长球才升得欢。' },
          { label: '以 ≤0.35m/s 上到 1.2 米', key: 'B/V + 轻踢', check: { t: 'ascend', to: 1.2, rate: 0.35 }, timeout: 90, coach: '攥着浮标线往上走。出水后别慌——船看得见那个橙色的球。' },
          { label: '升出水面，等船接应', check: { t: 'pickup' }, timeout: 30, coach: '在水面等着。引擎声由远及近——这就是漂流潜水的标准结局。' },
        ],
      },
      {
        id: 'ocn_wreck', name: '沉船外观潜水', map: 'wreck',
        brief: '海鹞号在二十多米深的海底。今天只许看外壳——进舱是另一本证的事。',
        intro: '前面就是海鹞号。规矩先说好：外观路线，不进舱。沉船里面是另一本证。',
        start: { node: 1, y: -1.5 },
        steps: [
          { label: '沿锚绳下潜到 15 米', key: 'S / G', check: { t: 'depth', at: 15, tol: 1.2, hold: 2 }, coach: '绳尽头就是残骸带。' },
          { label: '游到「船首」', check: { t: 'reach', node: 3, d: 5 }, timeout: 120, coach: '锈壳像一堵墙。抬头——桅杆还立着。' },
          { label: '上到「甲板」上方', check: { t: 'reach', node: 4, d: 5 }, timeout: 90, coach: '从甲板上面过，别碰栏杆上的珊瑚。' },
          { label: '外观拍摄 ≥1★', key: 'F × 2', check: { t: 'photo', min: 1 }, timeout: 90, coach: '船体、铜钟、或者趴在舱口的石斑——拍一张像样的。' },
          { label: '放出水面浮标', key: 'C', check: { t: 'key', code: 'KeyC' }, strict: true, coach: '从这里直接回家。放浮标。' },
          { label: '以 ≤0.3m/s 升到 6 米', key: 'B/V', check: { t: 'ascend', to: 6, rate: 0.3 }, timeout: 90, coach: '二十多米上来，把速度按住。' },
          { label: '6 米停留 4 秒', check: { t: 'depth', at: 6, tol: 0.8, hold: 4 }, coach: '深潜回来的停留不能省。' },
          { label: '游回潜水船出水', check: { t: 'exit' }, timeout: 90, coach: '浮标在水面等你。游回船边上去——课毕。' },
        ],
      },
    ],
  },
  {
    id: 'mil', name: '战术潜水员', en: 'Combat Diver',
    desc: '教官是退役战斗潜水员。他不教爆破——教的是军队那套"零容错纪律"怎么用在真洞潜上：CCR 伺候、黑暗冗余、引绳纪律、窄缝自知、寒区处置。',
    kit: '侧挂双瓶 · 主灯+备灯 · 备用二级头 · 线轮 · 罗盘 · CCR',
    lessons: [
      {
        id: 'mil_ccr', name: 'CCR 行前检查', map: H, ccr: true, gear: 'smt',
        brief: '开路式水肺吐泡泡，CCR 什么都不吐——但你要伺候好它。',
        intro: '检查程序一项项过。下水后它会定时报 PO2 警，听到滴滴声按 O 确认。',
        steps: [
          { label: '听任务简报', check: { t: 'say', dur: 5 }, coach: '今晚用 CCR：没有气泡，没人知道你在下面。代价：它需要你比它需要你的程度更需要你。' },
          { label: '氧电池自检', key: 'O', check: { t: 'key', code: 'KeyO' }, strict: true, coach: '按 O 读三只氧电池。' },
          { label: 'BCD 充气测试', key: 'B', check: { t: 'hold', code: 'KeyB', min: 1.0 } },
          { label: 'BCD 放气测试', key: 'V', check: { t: 'hold', code: 'KeyV', min: 1.0 } },
          { label: '面镜快速排水', key: 'H+N', check: { t: 'combo', codes: ['KeyH', 'KeyN'], min: 2.2 }, coach: '顺手把面镜也排了。' },
          { label: '应答 2 次 PO2 报警', key: 'O', check: { t: 'ccr', n: 2 }, timeout: 90, coach: '报警响就按 O。不许拖。' },
        ],
      },
      {
        id: 'mil_dark', name: '黑暗冗余', map: H, gear: 'smt',
        brief: '主灯随时会死。军队的第一课：第二条命在 Q 键上。',
        intro: '晚上好。老规矩：灯是命，也是靶子。今天学的是——灯灭了怎么办。',
        debrief: '真水里的灯故障没有预告。备灯不是配件，是命。',
        steps: [
          { label: '听任务简报', check: { t: 'say', dur: 5 }, coach: '洞潜跟夜战一个道理：冗余不是矫情，是你活下来的方式。主灯加备灯，两盏才算有灯。' },
          { label: '关灯', key: 'L', check: { t: 'lightoff' }, coach: '先关灯感受下——从现在开始，开灯 = 暴露。' },
          { label: '摸黑抵达 1 号浮标', check: { t: 'reach', node: 2, d: 2.6, dark: true }, timeout: 90, coach: '荧光浮标给你标了路。慢，稳，别出声。' },
          { label: '开主灯继续', key: 'L', check: { t: 'key', code: 'KeyL' }, strict: true, coach: '到位。开主灯，准备撤——' },
          { label: '主灯开始闪', fire: 'blackout', check: { t: 'wait', s: 5 }, coach: '（演练）主灯接触不良，马上要灭。手放到 Q 上。' },
          { label: '切备用灯', key: 'Q', check: { t: 'key', code: 'KeyQ' }, timeout: 8, strict: true, coach: 'Q——备灯！' },
          { label: '亮灯返回码头', check: { t: 'reach', node: 1, d: 3 }, timeout: 90, coach: '用备灯的光回码头。动作对一次，以后就是本能。' },
          { label: '听点评', check: { t: 'say', dur: 4 }, coach: '灯故障不挑时候。Q 是本能，不是操作。' },
        ],
      },
      {
        id: 'mil_line', name: '引绳纪律', map: 'dosojos', gear: 'smt',
        brief: '渗透的第一条纪律：永远知道自己的退路。洞潜的退路，就是那根引绳。',
        intro: '今天进真洞。规则只有一条：绳不离视线。走丢了，先找绳。',
        debrief: '引绳不是辅助，是合同——你答应它，它就答应你。',
        steps: [
          { label: '听任务简报', check: { t: 'say', dur: 5 }, coach: '引绳从入口铺到洞底。它不负责带路——它负责带你回家。' },
          { label: '沿引绳进洞到大厅', check: { t: 'reach', node: 1, d: 3.2 }, timeout: 90, coach: '跟着绳走。绳在哪，你就在哪。' },
          { label: '抓住引绳悬停', key: 'G', check: { t: 'linehold' }, timeout: 40, coach: '按 G 抓住绳，松开方向键——让绳替你稳住，这就叫"锚点报告"。' },
          { label: '松绳深入到珍珠厅', check: { t: 'reach', node: 4, d: 4 }, timeout: 150, coach: '再按 G 松手，继续往里。时不时回头看绳——别看丢了。' },
          { label: '顺绳回到大厅', check: { t: 'reach', node: 1, d: 3.5 }, timeout: 150, coach: '掉头，顺绳回来。洞潜的回程永远比去程重要。' },
          { label: '听点评', check: { t: 'say', dur: 4 }, coach: '绳不离视线。今天做到了，以后每次都做到。' },
        ],
      },
      {
        id: 'mil_crack', name: '窄缝自知', map: 'dosojos', gear: 'smt',
        brief: '战斗潜水员最怕的不是炸药，是一条你以为进得去的缝。',
        intro: '手绘图上标着一条支洞窄缝。去试试——记住：感觉顶住就退，这是纪律不是怂。',
        debrief: '缝不跟你讲道理。进得去，更要出得来。',
        steps: [
          { label: '听任务简报', check: { t: 'say', dur: 5 }, coach: '窄缝咬人不打招呼。要领就六个字：慢进、顶住、就退。今天练的就是"退"。' },
          { label: '游到烟厅附近的岔口', check: { t: 'reach', node: 9, d: 4.5 }, timeout: 160, coach: '烟厅边上岔出去一条道，窄得只剩条缝。先找到它。' },
          { label: '钻进窄缝再退出', key: '慢游', check: { t: 'squeeze' }, timeout: 140, coach: '侧身慢探——感觉顶住就是到头了。别硬挤，退出来。' },
          { label: '回到主线通道', check: { t: 'reach', node: 9, d: 6 }, timeout: 90, coach: '回主线。能进去更要能出来。' },
          { label: '听点评', check: { t: 'say', dur: 4 }, coach: '顶住就退。这四个字以后救你的命。' },
        ],
      },
      {
        id: 'mil_beacon', name: '信标布放', map: H, buddy: false, gear: 'smt',
        brief: '一个人，一块信标，一条黑航线。放好了就撤。',
        intro: '这次一个人下。不是炸药——是留给搜救队的信标。到船底按 E 布放，然后回家。',
        debrief: '布放的要领不变：到位、固定、撤。跟布的是什么无关。',
        steps: [
          { label: '关灯下潜', key: 'L', check: { t: 'lightoff' }, coach: '老规矩，灯关掉。' },
          { label: '摸黑抵达船底布放点', check: { t: 'reach', node: 3, d: 2.8, dark: true }, timeout: 90, coach: '信标点在船底龙骨下。' },
          { label: '布放信标', key: 'E', check: { t: 'deploy', node: 3 }, timeout: 30, strict: true, coach: '就位。按 E 把信标挂上去。' },
          { label: '撤到 1 号浮标', check: { t: 'reach', node: 2, d: 2.8, dark: true }, timeout: 90, coach: '放下就走，别回头看。' },
          { label: '返回码头出水', check: { t: 'exit' }, timeout: 90, coach: '回家。信标会替你喊。' },
        ],
      },
      {
        id: 'mil_frost', name: '寒区事故处置', map: 'icelake', gear: 'smt',
        brief: '冰下的敌人不是黑暗，是时间和体温：自由流来了换备头，手指僵了往绳靠。',
        intro: '冰潜的规矩：头顶只有一块冰，出口只有一个洞。今天考的是——出事了怎么办。',
        debrief: '寒区不惩罚快的人，惩罚没准备的人。',
        steps: [
          { label: '听任务简报', check: { t: 'say', dur: 5 }, coach: '冰下两种死法排前两名：二级头自由流跑气，和体温掉到手指不听使唤。今天都练。' },
          { label: '沿安全绳到蓝光走廊', check: { t: 'reach', node: 2, d: 4 }, timeout: 140, coach: '安全绳是唯一的回洞路。下去，记住它在哪。' },
          { label: '二级头自由流——换备头', fire: 'freeflow', key: 'Q', check: { t: 'key', code: 'KeyQ' }, timeout: 8, strict: true, coach: '嘶——二级头跑气了！Q，换备头！' },
          { label: '稳住呼吸 4 秒', check: { t: 'wait', s: 4 }, coach: '换好了稳住。自由流最怕慌——气在漏，你慌不起。' },
          { label: '沿绳回冰洞口', check: { t: 'reach', node: 1, d: 3.5 }, timeout: 140, coach: '回绳那边去。冰下没有"再逛会儿"。' },
          { label: '出水', check: { t: 'exit' }, timeout: 60, coach: '上冰面。课毕。' },
        ],
      },
    ],
  },
  {
    id: 'nat', name: '洞穴生物学家', en: 'Cave Naturalist',
    desc: '认识洞里的生命与地质：每个物种先讲识别要点，再让你亲手找到、拍下来——拍到的都会进图鉴。',
    kit: '相机 · 主灯 · 图鉴手账',
    lessons: [
      natLesson('nat_fish', '识别鱼类', '洞口的鳟鱼、鲶鱼，到洞里已经瞎掉的盲鱼。', '鱼是洞穴里最显眼的住客。先学怎么分辨它们。', ['catfish', 'trout', 'blindfish', 'cavefish']),
      natLesson('nat_invert', '识别无脊椎动物', '虾、虫、螯虾、螺：个头小，但数量最多。', '蹲下来，灯放轻一点——这些小家伙一惊就躲。', ['shrimp', 'isopod', 'crayfish', 'snail']),
      natLesson('nat_life', '洞穴里的生命线', '洞螈、藻、蕨和菌膜：没有太阳，也要活下去。', '这一课看的是更安静的生命：从最稀有的洞螈，到最不起眼的菌膜。', ['olm', 'algae', 'fern', 'bacteria', 'ironbac']),
      natLesson('nat_geo', '洞穴地质与化石', '钟乳石、石柱、流石、石膏花，还有岩壁里的远古。', '一滴一滴，十万年。这些东西只能拍，不能碰。', ['stalactite', 'column', 'helictite', 'flowstone', 'pearl', 'gypsum', 'fossil', 'bones']),
    ],
  },
];

export function getCourse(id) { return COURSES.find(c => c.id === id); }
export function getLesson(cid, lid) { return getCourse(cid)?.lessons.find(l => l.id === lid); }

export const GESTURE_NAME = { ok: 'OK', up: '上升', help: '求助', line: '指引绳', light: '灯信号' };
