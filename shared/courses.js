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
    id: 'mil', name: '战术潜水员', en: 'Combat Diver',
    desc: '军队场景：CCR 密闭循环呼吸器、静默渗透、爆破物布放。没有气泡，没有灯，没有第二次。',
    kit: 'CCR 密闭循环 · 干式潜水服 · 爆破装置 · 罗盘 · 低光战术灯',
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
        id: 'mil_stealth', name: '静默渗透', map: H, ccr: true, gear: 'smt',
        brief: '全程不开灯。靠月光、浮标和罗盘摸到货船底下。',
        intro: '灯从下水那一刻起就是敌人。按 L 确认关了，然后一路黑到船底。',
        steps: [
          { label: '关灯', key: 'L', check: { t: 'lightoff' }, coach: '把灯关了。从现在开始，开灯 = 暴露。' },
          { label: '摸黑抵达 1 号浮标', check: { t: 'reach', node: 2, d: 2.6, dark: true }, coach: '跟着化学荧光浮标走。慢慢游，碰出动静也算输。' },
          { label: '摸黑抵达船底', check: { t: 'reach', node: 3, d: 2.8, dark: true }, coach: '头顶那片更黑的黑，就是船底。' },
          { label: '摸黑抵达锚链点', check: { t: 'reach', node: 5, d: 2.8, dark: true }, coach: '最后一个点，锚链。' },
          { label: '摸黑返回码头', check: { t: 'reach', node: 1, d: 3, dark: true }, timeout: 90, coach: '原路回去。PO2 报警照常要应。' },
        ],
      },
      {
        id: 'mil_charge', name: '爆破物布放', map: H, ccr: true, buddy: false, gear: 'smt',
        brief: '一个人，一块药，一艘靶船。放好了就撤，PO2 报警照应。',
        intro: '这次你一个人下。到船底按 E 布放，然后回码头。全程计时。',
        steps: [
          { label: '关灯下潜', key: 'L', check: { t: 'lightoff' }, coach: '老规矩，灯关掉。' },
          { label: '抵达船底布放点', check: { t: 'reach', node: 3, d: 2.8, dark: true }, timeout: 90, coach: '目标在船底龙骨的装置位。' },
          { label: '布放爆破装置', key: 'E', check: { t: 'deploy', node: 3 }, timeout: 30, strict: true, coach: '就位。按 E 把装置挂上去。' },
          { label: '撤到 1 号浮标', check: { t: 'reach', node: 2, d: 2.8, dark: true }, coach: '放下就走，别回头看。' },
          { label: '返回码头出水', check: { t: 'exit' }, timeout: 90, coach: '回家。装置自己知道什么时候响。' },
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
