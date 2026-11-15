// Built-in sample data for ?mock=1, plus a small in-memory stand-in for the service so every
// button does something visible. Two lines: the article summary line from the mockup, and a
// simpler weekly report line that has a gate judged by an AI. Nothing here talks to the
// network; a page reload resets everything.

const ARTICLE = `# 屋顶种菜的三年

老城区的一栋六层居民楼，三年前把闲置的楼顶改成了菜园。最初只有顶楼的两户人家参与，用的是旧泡沫箱和从花市买来的营养土。第一年夏天，番茄和辣椒长得不错，但雨季一到，排水口被落叶和泥土堵住，积水渗进了六楼住户的天花板，楼里为此开了两次会，差点把菜园拆掉。

第二年，居民自己凑钱请人重做了防水层，又在种植箱下面垫了一层架空的塑料托盘，让雨水能直接流向排水口。同时定了三条规矩：每户最多四个箱子，不许用未腐熟的肥料，每周轮流清理一次排水口。参与的人家从两户增加到十一户。

到第三年，菜园已经成了这栋楼的公共客厅。夏天傍晚，老人在楼顶乘凉，孩子认识了十几种蔬菜。物业测过，顶楼两户夏季室内温度比没有覆盖的邻楼低了两到三度。但问题也还在：冬天几乎没人上去，箱子里的土板结严重；有两户搬走之后，他们的箱子至今没人接手。`;

const POINTS = '- 屋顶菜园三年前由顶楼两户起步\n- 第一年雨季排水口堵塞，积水渗进六楼天花板\n- 第二年重做防水、定下三条规矩，参与户数增至十一户\n- 第三年成为公共客厅，顶楼夏季室温低两到三度\n- 冬天少人打理，搬走住户的箱子无人接手';

const S97 = '屋顶菜园三年前由两户起步，首年因排水堵塞差点被拆；第二年重做防水、加架空托盘并定下三条规矩，参与户数增至十一户。菜园成了公共客厅，顶楼两户夏季室温低两到三度。两户搬走后，他们的箱子至今无人接手。';
const S110 = '屋顶菜园由顶楼两户三年前发起，第一年因排水堵塞渗水，第二年重做防水并定下每户四箱等规矩，参与户数增至十一户。第三年它成为楼里公共客厅，夏季顶楼室内比邻楼低两到三度。两户搬走后，他们的箱子至今无人接手，冬天也几乎无人照看。';
const S_OVER = '屋顶菜园三年前由顶楼两户起步，第一年因雨季排水堵塞导致积水渗入六楼天花板，次年重做防水并加架空托盘，定下规矩后参与户数增至十一户。第三年菜园成为楼里的公共客厅，夏季顶楼室温比邻楼低两到三度。但冬季几乎无人打理，箱子里的土板结，两户搬走后也无人接手。';
const LONG_A = '屋顶菜园三年前由两户人家用旧泡沫箱起步，第一年雨季排水口堵塞，积水渗进六楼天花板，险些被拆掉。居民凑钱重做防水、加架空托盘并定下三条规矩，参与户数从两户增至十一户。第三年菜园成了公共客厅，夏傍晚老人乘凉，孩子认识十几种蔬菜；物业测得顶楼夏季室内温度比邻楼低两到三度。冬天少有人上去，箱内土板结严重，两户搬走后，他们的箱子至今无人接手。';
const LONG_B = '屋顶菜园三年前由顶楼两户用旧泡沫箱和营养土起步，种番茄辣椒。第一年雨季排水口堵塞，积水渗进六楼天花板，楼里差点拆掉菜园。第二年居民凑钱重做防水层、加架空托盘，并定下三条规矩，参与户数由两户增至十一户。第三年菜园成了公共客厅，夏天顶楼室内温度比邻楼低两到三度。冬天几乎无人打理，箱内土板结，搬走住户的箱子也无人接手。';
const LONG_C = '老城区一栋六层居民楼三年前把闲置楼顶改成菜园，最初只有顶楼两户用旧泡沫箱和花市买的营养土种番茄辣椒。第一年雨季排水口被落叶堵住，积水渗进六楼天花板，楼里开了两次会差点拆掉。第二年大家凑钱重做防水层、垫架空托盘，定下每户最多四箱、不用未腐熟肥料、每周轮流清排水口三条规矩，参与户数增至十一户。第三年菜园成了公共客厅，顶楼夏季室温低两到三度，但冬天没人上去，搬走住户的箱子无人接手。';

const ARTICLE_2 = `# 社区食堂的第一年

街道办去年春天在旧锅炉房里开了一家社区食堂，面向六十岁以上的老人，一顿午饭收八块钱。开张头三个月每天只有二三十人来，厨房按一百人备料，剩菜多得倒掉都心疼。

夏天起食堂改了两件事：一是提前一天在楼栋群里接龙订餐，按人数备料；二是请了三位退休的老师傅轮流掌勺，每周换菜单。到秋天，每天来吃饭的稳定在九十人上下，还有十几位行动不便的老人由志愿者送餐上门。

问题也有。八块钱的定价靠街道补贴才撑得住，补贴明年还有没有，现在谁也说不准；志愿者以大学生为主，一到寒暑假送餐就排不过来；附近两家小饭馆的老板来反映过，说中午的生意少了三成。`;

const NOTES = '周一：和供应商开会，定了新的交货时间（每周三）。\n周二：改完了报价单模板，发给了三位同事试用。\n周三：仓库盘点，发现少了两箱 A4 纸。\n周四：请假半天。下午回了十几封客户邮件。\n周五：新人小林入职，带他走了一遍流程。';
const REPORT_NO_PLAN = '本周完成\n- 和供应商定了新的交货时间：每周三\n- 改完报价单模板，三位同事在试用\n- 仓库盘点，少了两箱 A4 纸\n- 带新人小林走了一遍流程';
const REPORT_OK = '本周完成\n- 和供应商定了新的交货时间：每周三\n- 改完报价单模板，三位同事在试用\n- 仓库盘点，发现少了两箱 A4 纸\n- 带新人小林走了一遍流程\n\n下周计划\n- 查清少的两箱 A4 纸去了哪\n- 收集同事对报价单模板的意见';
const REPORT_OK2 = '本周完成\n- 供应商交货时间改为每周三\n- 新报价单模板已发给三位同事试用\n- 盘点发现少两箱 A4 纸\n- 新人小林入职，已带他熟悉流程\n\n下周计划\n- 追查缺少的 A4 纸\n- 汇总报价单模板的试用意见';

const chars = (t) => [...t.replace(/\s/g, '')].length;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const clock = () => stamp().slice(11);
const minute = () => stamp().slice(0, 16);
const TODAY = stamp().slice(0, 10);
const clone = (v) => JSON.parse(JSON.stringify(v));
const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

const nodeOf = (def, id) => def.nodes.find((n) => n.id === id);
const isAuto = (n) => n.kind === 'gate' && (n.judge === 'machine' || n.judge === 'ai');
const isHuman = (n) => n.kind === 'gate' && !isAuto(n);

// What the first automatic gate of a line would say about a text: '' when it passes.
function problemOf(def, text) {
  const c = def.nodes.find((n) => n.kind === 'gate' && n.judge === 'machine')?.checks || {};
  const n = chars(text);
  if (c.max_chars != null && n > c.max_chars) return `超出 ${n - c.max_chars} 字`;
  if (c.min_chars != null && n < c.min_chars) return `少 ${c.min_chars - n} 字`;
  const missing = (c.must_include || []).filter((s) => !text.includes(s));
  if (missing.length) return `缺少${missing.map((s) => `「${s}」`).join('')}`;
  return '';
}

// ---------- worlds: one per line ----------

// W is the line the page is looking at. Every function below works on W.
let W = null;
const worlds = [];

// Timers belong to the world they were started in, whichever line the page shows by then.
function later(fn, ms = 3000) {
  const mine = W;
  setTimeout(() => { const shown = W; W = mine; try { fn(); } finally { W = shown; } }, ms);
}

// samples: [{ name, text, kinds }]; kinds says how each trial run of that sample turns out
function makeWorld(folder, line, sample, history, samples) {
  const w = {
    folder, line, sample, history, samples,
    versions: {}, flows: {},
    trial: null, trialDetails: {}, proposal: null, proposalDetails: {},
    items: [], nextNumber: 1,
  };
  worlds.push(w);
  return w;
}

function warningsOf(def) {
  const out = [];
  def.flow.forEach((id, i) => {
    const a = nodeOf(def, id), b = nodeOf(def, def.flow[i + 1]);
    if (a.kind === 'station' && b && b.kind !== 'gate') out.push(`「${a.title}」后面还没有门`);
  });
  return out;
}

function trialProblem() {
  const t = W.trial;
  if (!t || t.version !== W.line.version) return '这一版还没试跑过';
  if (t.running) return '这一版正在试跑，还没出结果';
  if (t.error || t.ok < t.runs) return `这一版试跑 ${t.runs} 次，只走通 ${t.ok} 次`;
  return '';
}

const pending = () => !!W.proposal && (W.proposal.state === 'working' || W.proposal.state === 'ready');

function publicLine() {
  const out = clone(W.line);
  out.trial = W.trial && W.trial.version === W.line.version ? clone(W.trial) : null;
  out.proposal = W.proposal ? clone(W.proposal) : null;
  out.history = W.history.map((h) => ({ ...h, current: h.version === W.line.version }));
  out.warnings = warningsOf(W.line);
  out.samples = W.samples.map((x) => ({ name: x.name, chars: chars(x.text) }));
  out.worker_name = 'Claude';
  return out;
}

function publicLines() {
  return worlds.map((w) => ({
    id: w.folder, name: w.line.name, version: w.line.version, approved: w.line.approved_version === w.line.version,
    waiting: w.items.filter((it) => it.state === 'waiting').length, stopped: w.items.filter((it) => it.state === 'stopped').length,
    running: w.items.filter((it) => it.state === 'running').length, proposal_ready: w.proposal?.state === 'ready',
    current: w === W,
  }));
}

function newVersion(by, note, approved) {
  const line = W.line;
  W.versions[line.version] = clone(line.nodes);
  W.flows[line.version] = clone(line.flow);
  line.version += 1;
  line.changed_by = by; line.changed_at = minute();
  line.approved_version = approved ? line.version : null;
  line.approved_at = approved ? minute() : null;
  W.history = [{ version: line.version, by, at: line.changed_at, note }, ...W.history];
}

// ---------- items ----------

const judgedLine = (n, text, problem, stops) => `第 ${n} 次：${problem ? `不合格（${chars(text)} 字，${problem}）。${stops ? '已到上限，停线。' : '已退回重写。'}` : `合格（${chars(text)} 字）`}`;

// Build an item as the engine would leave it after running `def` on the sample:
// 'clean' passes first time, 'retry' is sent back once, 'stuck' hits the limit and stops.
function simulate(def, id, name, kind, created, input = W.sample.input) {
  const s = W.sample;
  const gates = def.nodes.filter(isAuto), human = def.nodes.find(isHuman);
  const first = gates[0];
  const maker = first?.on_fail || human?.on_fail;
  const limit = first?.max_tries || 3;
  const texts = kind === 'stuck' ? s.stuck.slice(0, limit) : kind === 'retry' ? s.retry : s.clean;
  const tries = texts.map((text, i) => {
    const problem = kind === 'clean' || (kind === 'retry' && i === texts.length - 1) ? '' : problemOf(def, text) || '不合格';
    return { n: i + 1, round: i + 1, chars: chars(text), text, verdict: problem ? `不合格：${problem}` : '合格', problem, stops: kind === 'stuck' && i === texts.length - 1 };
  });
  const it = {
    id, name, title: '', created, line_version: def.version, state: 'waiting', at: human?.id || 'out', why: null, pid: null,
    nodes: {}, walked: [], back: {}, round: {}, tries: {}, judged: {}, history: [], files: {},
  };
  const t0 = created.slice(11);
  for (let i = 0; i < def.flow.length; i++) {
    const n = nodeOf(def, def.flow[i]), next = def.flow[i + 1];
    if (n.kind === 'source') {
      it.nodes[n.id] = { state: 'done' }; it.files[n.file] = input;
      it.history.push([t0, n.title, '投料', `${chars(input)} 字`]); it.walked.push(`${n.id}>${next}`);
    } else if (n.kind === 'station') {
      it.nodes[n.id] = { state: 'done' };
      if (n.id === maker) {
        it.tries[n.id] = tries.map(({ n: k, round, chars: c, text, verdict }) => ({ n: k, round, chars: c, text, verdict }));
        it.files[n.output] = texts[texts.length - 1]; it.round[n.id] = tries.length;
        it.history.push([t0, n.title, '做完', `第 1 次，${tries[0].chars} 字，用了 2.9 秒`]);
      } else {
        it.tries[n.id] = [{ n: 1, round: 1, chars: chars(s.mid), verdict: '做完', text: s.mid }]; it.files[n.output] = s.mid;
        it.history.push([t0, n.title, '做完', `第 1 次，${chars(s.mid)} 字，用了 2.8 秒`]);
      }
      it.walked.push(`${n.id}>${next}`);
    } else if (isAuto(n)) {
      if (n === first) {
        it.judged[n.id] = tries.map((t) => judgedLine(t.n, t.text, t.problem, t.stops));
        tries.forEach((t, k) => {
          if (k > 0) it.history.push([t0, nodeOf(def, maker).title, '做完', `第 ${t.n} 次，${t.chars} 字，用了 3.1 秒`]);
          it.history.push([t0, n.title, t.problem ? (t.stops ? '停线' : '不合格，退回') : '合格', t.problem ? (t.stops ? `${tries.length} 次都不合格，没有放到后面去` : t.problem) : `${t.chars} 字`]);
        });
        if (tries.length > 1) { it.walked.push(`${n.id}>${maker}`); it.back[`${n.id}>${maker}`] = tries.length - 1; }
        if (kind === 'stuck') {
          it.nodes[n.id] = { state: 'fail' }; it.nodes.stop = { state: 'stopped' }; it.walked.push(`${n.id}>stop`);
          it.state = 'stopped'; it.at = 'stop'; it.resume_from = maker;
          it.why = `「${nodeOf(def, maker).title}」连写 ${tries.length} 次都没过「${n.title}」这道门（最后一次：${tries[tries.length - 1].problem}）。不合格的东西没有流到后面。`;
          it.history.push([t0, '停线', '停下等你处理', it.why]);
          return it;
        }
      } else {
        const last = tries[tries.length - 1];
        it.judged[n.id] = [judgedLine(1, last.text, '', false)];
        it.history.push([t0, n.title, '合格', `${last.chars} 字`]);
      }
      it.nodes[n.id] = { state: 'pass' }; it.walked.push(`${n.id}>${next}`);
    } else if (isHuman(n)) {
      it.nodes[n.id] = { state: 'wait' }; it.history.push([t0, n.title, '等你验收', '']);
      return it;
    }
  }
  return it;
}

// Turn a waiting item into a shipped one.
function shipIt(it) {
  const def = W.line, gate = def.nodes.find(isHuman), next = def.flow[def.flow.indexOf(gate.id) + 1];
  const t = `${it.created.slice(11, 16)}:40`;
  it.nodes[gate.id] = { state: 'pass' }; it.nodes[next] = { state: 'done' };
  it.walked.push(`${gate.id}>${next}`); it.state = 'done'; it.at = next;
  const list = it.tries[gate.on_fail];
  list[list.length - 1].verdict = '你验收合格';
  (it.judged[gate.id] = it.judged[gate.id] || []).push(`${t} 你判了合格`);
  it.history.push([t, gate.title, '合格', '你点了“合格，出货”'], [t, nodeOf(def, next).title, '已出货', nodeOf(def, next).file]);
  return it;
}

const STATE_NAME = { running: '正在做', waiting: '等你验收', stopped: '停线', done: '已出货', abandoned: '已放弃', idle: '停着' };
const findItem = (id) => W.items.find((it) => it.id === id);
const summaryOf = (it) => ({ id: it.id, name: it.name, title: it.title || '', state: it.state, state_name: STATE_NAME[it.state], at: it.at, created: it.created });

function detailOf(it, readonly) {
  const d = clone(it);
  d.state_name = STATE_NAME[it.state];
  d.folder = `C:\\ai_workflow\\lines\\${W.folder}\\items\\${it.id}`;
  for (const n of Object.values(d.nodes)) if (n.state === 'run' && n.since) n.seconds = Math.round(Date.now() / 1000 - n.since);
  if (readonly) d.readonly = true;
  return d;
}

// A batch of trial runs of `def`: every sample is run `per` times. All runs get stuck when even
// the best sample text cannot pass the first gate.
function trialBatch(def, per) {
  const stuckAll = !!problemOf(def, W.sample.retry[W.sample.retry.length - 1]);
  const details = {}, list = [], stats = [];
  let k = 0;
  for (const sample of W.samples) {
    const stat = { name: sample.name, runs: per, ok: 0 };
    stats.push(stat);
    for (let i = 0; i < per; i++) {
      const kind = stuckAll ? 'stuck' : sample.kinds[i % sample.kinds.length];
      const it = simulate(def, String(++k).padStart(4, '0'), `样例「${sample.name}」第 ${i + 1} 次`, kind, stamp(), sample.text);
      details[it.id] = it;
      const through = it.state === 'waiting' || it.state === 'done';
      const backs = Object.values(it.back).reduce((n, v) => n + v, 0);
      stat.ok += through ? 1 : 0;
      list.push({
        id: it.id, name: it.name, sample: sample.name, state: it.state,
        state_name: !through ? '没走通' : backs ? `走通了，中途被退回 ${backs} 次` : '走通了，一遍过', why: it.why, back: backs, at: it.at,
      });
    }
  }
  return { runs: list.length, ok: stats.reduce((n, x) => n + x.ok, 0), items: list, samples: stats, details };
}

function setTrial(batch) {
  W.trial = { version: W.line.version, at: stamp(), runs: batch.runs, ok: batch.ok, running: false, error: null, items: batch.items, samples: batch.samples };
  W.trialDetails = batch.details;
}

// `per` is how many times each sample is run; by default 3 with one sample, 2 with several
function runTrial(per) {
  const v = W.line.version, each = per || (W.samples.length < 2 ? 3 : 2);
  W.trial = { version: v, at: stamp(), runs: each * W.samples.length, ok: 0, running: true, error: null, items: [], samples: [] };
  W.trialDetails = {};
  later(() => { if (W.trial?.running && W.line.version === v) setTrial(trialBatch(W.line, each)); }, 4000);
}

// Pretend the engine starts working at a node.
function startRun(it, from) {
  const flow = W.line.flow, at = flow.indexOf(from);
  for (const id of [...flow.slice(at), 'stop']) delete it.nodes[id];
  it.walked = it.walked.filter((w) => !flow.slice(at).includes(w.split('>')[0]));
  it.state = 'running'; it.at = from; it.why = null; delete it.resume_from;
  const node = nodeOf(W.line, from);
  if (node.kind === 'station' || node.judge === 'ai') it.nodes[from] = { state: 'run', since: Date.now() / 1000 };
  it.history.push([clock(), node.title, node.kind === 'station' ? '正在做' : '正在判', '']);
}

// Pretend the engine ran from `it.at` to the human gate with a passing result.
function arrive(it, only) {
  if (it.state !== 'running') return;
  const def = W.line, flow = def.flow, s = W.sample;
  const maker = def.nodes.find(isHuman).on_fail;
  for (let i = flow.indexOf(it.at); i < flow.length; i++) {
    const n = nodeOf(def, flow[i]), next = flow[i + 1];
    if (n.kind === 'station') {
      const list = (it.tries[n.id] = it.tries[n.id] || []);
      const text = n.id === maker ? s.good[list.length % s.good.length] : s.mid;
      it.round[n.id] = (it.round[n.id] || 0) + 1;
      list.push({ n: list.length + 1, round: it.round[n.id], chars: chars(text), verdict: '做完', text });
      it.files[n.output] = text; it.nodes[n.id] = { state: 'done' };
      it.history.push([clock(), n.title, '做完', `第 ${list.length} 次，${chars(text)} 字，用了 3 秒`]);
      if (only) { it.state = 'idle'; it.at = n.id; it.history.push([clock(), n.title, '停着', '只重做了这一步，没有往后走']); return; }
    } else if (isAuto(n)) {
      const list = it.tries[n.on_fail] || [];
      const last = list[list.length - 1];
      if (last) last.verdict = '合格';
      const judged = (it.judged[n.id] = it.judged[n.id] || []);
      judged.push(`第 ${judged.length + 1} 次：合格（${last ? last.chars : 0} 字）`);
      it.nodes[n.id] = { state: 'pass' }; it.history.push([clock(), n.title, '合格', `${last ? last.chars : 0} 字`]);
    } else if (isHuman(n)) {
      it.nodes[n.id] = { state: 'wait' }; it.state = 'waiting'; it.at = n.id; it.history.push([clock(), n.title, '等你验收', '']);
      return;
    }
    if (next && !it.walked.includes(`${n.id}>${next}`)) it.walked.push(`${n.id}>${next}`);
  }
}

// What the pretend AI does to the line: add a station when asked to, otherwise touch one node.
function proposeLine(scope, text) {
  const def = clone(W.line);
  const maker = def.nodes.find(isHuman).on_fail;
  if (/加.*站/.test(text)) {
    const at = def.flow.indexOf(maker), before = nodeOf(def, maker);
    def.nodes.splice(def.nodes.indexOf(before), 0, { id: 'check', kind: 'station', title: '核对事实', input: before.input, output: '15-checked.md', timeout: 300,
      spec: '对照原料逐条核对，删掉原料里没有的内容。\n每条一行，保持原来的写法。' });
    def.flow.splice(at, 0, 'check');
    before.input = '15-checked.md';
    return { def, summary: [`（样例）在「${before.title}」前面加了一站「核对事实」。`, `（样例）「${before.title}」改成读核对过的内容。`] };
  }
  const target = scope !== 'line' ? nodeOf(def, scope) : null;
  const add = (node, key, what) => { node[key] = `${node[key]}\n（按意见补充：${text}）`; return { def, summary: [`（样例）在「${node.title}」的${what}里加了一句：${text}`, '（样例）别的站和门没有动。'] }; };
  if (target && isHuman(target)) return add(target, 'points', '验收要点');
  if (target && target.judge === 'ai') return add(target, 'criteria', '合格标准');
  return add(target && target.kind === 'station' ? target : nodeOf(def, maker), 'spec', '规格');
}

// ---------- the two lines ----------

W = makeWorld('article-summary', {
  id: 'article-summary', name: '文章摘要线',
  input: '一篇中文文章', output: '一段 60 到 120 字的摘要',
  retire: '这是试验用的玩具线，试验做完就整条删掉',
  worker: 'claude', model: 'haiku',
  version: 2, approved_version: null, approved_at: null,
  changed_by: 'AI（你点头采用）', changed_at: `${TODAY} 22:29`,
  flow: ['in', 'extract', 'summarize', 'gate', 'review', 'out'],
  nodes: [
    { id: 'in', kind: 'source', title: '一篇文章', file: '00-input.md' },
    { id: 'extract', kind: 'station', title: '提要点', input: '00-input.md', output: '10-points.md', timeout: 300,
      spec: '从输入的文章里提取 3 到 5 条要点。\n每条一行，每条不超过 40 个字。\n只写文章里有的内容，不加自己的看法。' },
    { id: 'summarize', kind: 'station', title: '写摘要', input: '10-points.md', output: '20-summary.md', timeout: 300,
      spec: '根据要点写一段中文摘要。\n最多 3 句话，只有一段，不用标题和列表，宁短勿长。\n如果是被退回重写，按退回理由修改。' },
    { id: 'gate', kind: 'gate', judge: 'machine', title: '字数和格式', file: '20-summary.md',
      checks: { min_chars: 60, max_chars: 120, single_paragraph: true, no_preamble: true }, on_fail: 'summarize', max_tries: 3 },
    { id: 'review', kind: 'gate', judge: 'human', title: '验收', file: '20-summary.md',
      points: '读着通顺、没有编造、愿意直接拿去用。', on_fail: 'summarize' },
    { id: 'out', kind: 'product', title: '一段摘要', file: '20-summary.md' },
  ],
  layout: {},
}, { input: ARTICLE, mid: POINTS, clean: [S110], retry: [S_OVER, S97], stuck: [LONG_B, LONG_C, LONG_A], good: [S110, S97] }, [
  { version: 2, by: 'AI（你点头采用）', at: `${TODAY} 22:29`, note: '你的意见：摘要老是超字数。AI 改了：在「写摘要」的规格里加了"宁短勿长"，并说明被退回时要按理由改' },
  { version: 1, by: 'AI', at: `${TODAY} 21:50`, note: '最初的版本' },
], [
  { name: '屋顶种菜的三年', text: ARTICLE, kinds: ['retry', 'clean', 'clean'] },
  { name: '长文-社区食堂', text: ARTICLE_2, kinds: ['clean', 'stuck', 'retry'] },
]);
{
  const v1 = clone(W.line.nodes);
  v1[2].spec = '根据要点写一段中文摘要。\n最多 3 句话，只有一段，不用标题和列表。';
  W.versions[1] = v1; W.flows[1] = clone(W.line.flow);
  const running = simulate(W.line, '0016', '第 16 件', 'clean', `${TODAY} 22:41:01`);
  Object.assign(running, { state: 'running', at: 'summarize', judged: {}, round: { summarize: 1 },
    nodes: { in: { state: 'done' }, extract: { state: 'done' }, summarize: { state: 'run', since: Date.now() / 1000 - 40 } },
    walked: ['in>extract', 'extract>summarize'], tries: { extract: running.tries.extract }, files: { '00-input.md': ARTICLE, '10-points.md': POINTS } });
  running.history = [...running.history.slice(0, 2), ['22:41:05', '写摘要', '正在做', '']];
  W.items = [
    running,
    simulate(W.line, '0012', '第 12 件', 'retry', `${TODAY} 22:29:40`),
    simulate(W.line, '0003', '第 3 件', 'stuck', `${TODAY} 22:28:01`),
    shipIt(simulate(W.line, '0015', '第 15 件', 'clean', `${TODAY} 22:30:09`)),
  ];
  W.nextNumber = 17;
  setTrial(trialBatch(W.line, 3));
}

W = makeWorld('weekly-report', {
  id: 'weekly-report', name: '周报线',
  input: '一周的工作记录（随手记的流水账）', output: '一份分"本周完成""下周计划"两块的周报',
  retire: '不再需要每周交周报的时候拆',
  worker: 'claude', model: 'haiku',
  version: 1, approved_version: 1, approved_at: `${TODAY} 20:10`,
  changed_by: 'AI', changed_at: `${TODAY} 20:02`,
  flow: ['in', 'draft', 'format', 'facts', 'review', 'out'],
  nodes: [
    { id: 'in', kind: 'source', title: '工作记录', file: '00-notes.md' },
    { id: 'draft', kind: 'station', title: '写周报', input: '00-notes.md', output: '10-report.md', timeout: 300, model: 'sonnet',
      spec: '把工作记录整理成一份周报。\n分两块：先写"本周完成"，再写"下周计划"。每件事一行。\n只写记录里有的事。' },
    { id: 'format', kind: 'gate', judge: 'machine', title: '两块都在', file: '10-report.md',
      checks: { must_include: ['本周完成', '下周计划'] }, on_fail: 'draft', max_tries: 3 },
    { id: 'facts', kind: 'gate', judge: 'ai', title: '没有编造', file: '10-report.md', reference: '00-notes.md',
      criteria: '周报里的每件事，都能在工作记录里找到出处\n没有把请假、闲聊这类不算工作的事写成成果\n"下周计划"里的每一条，都接得上本周没做完的事', on_fail: 'draft', max_tries: 2 },
    { id: 'review', kind: 'gate', judge: 'human', title: '验收', file: '10-report.md',
      points: '能直接发给主管；没有漏掉重要的事。', on_fail: 'draft' },
    { id: 'out', kind: 'product', title: '一份周报', file: '10-report.md' },
  ],
  layout: {},
}, { input: NOTES, mid: NOTES, clean: [REPORT_OK], retry: [REPORT_NO_PLAN, REPORT_OK], stuck: [REPORT_NO_PLAN, REPORT_NO_PLAN, REPORT_NO_PLAN], good: [REPORT_OK2, REPORT_OK] }, [
  { version: 1, by: 'AI', at: `${TODAY} 20:02`, note: '最初的版本' },
], [{ name: '普通的一周', text: NOTES, kinds: ['retry', 'clean'] }]);
{
  // one item waits for the user, one is with the AI inspector right now
  const judging = simulate(W.line, '0002', '第 2 件', 'clean', `${TODAY} 22:43:10`);
  delete judging.nodes.review; delete judging.judged.facts;
  Object.assign(judging, { state: 'running', at: 'facts', walked: ['in>draft', 'draft>format', 'format>facts'] });
  judging.nodes.facts = { state: 'run', since: Date.now() / 1000 - 12 };
  judging.history = [...judging.history.filter((h) => h[1] !== '没有编造' && h[1] !== '验收'), ['22:43:16', '没有编造', '正在判', '']];
  W.items = [simulate(W.line, '0001', '第 1 件', 'retry', `${TODAY} 22:35:20`), judging];
  W.nextNumber = 3;
  setTrial(trialBatch(W.line, 3));
}
W = worlds[0];

// ---------- requests ----------

function post(path, body) {
  const line = W.line;
  let m;
  if (path === 'lines/switch') {
    const target = worlds.find((w) => w.folder === body.id);
    if (!target) return fail('找不到这条线');
    W = target;
    return ok();
  }
  if (path === 'line/sample') {
    const text = String(body.text || '');
    if (!text.trim()) return fail('样例是空的');
    const name = String(body.name || `样例${W.samples.length + 1}`).trim().slice(0, 40);
    if (W.samples.some((x) => x.name === name)) return fail(`已经有一份叫「${name}」的样例了，换个名字`);
    W.samples.push({ name, text: text.trim(), kinds: ['clean', 'retry'] });
    return ok({ name });
  }
  if (path === 'line/sample/remove') {
    const at = W.samples.findIndex((x) => x.name === body.name);
    if (at < 0) return fail('找不到这份样例');
    if (W.samples.length <= 1) return fail('至少要留一份样例，不然没法试跑');
    W.samples.splice(at, 1);
    return ok();
  }
  if (path === 'line/layout') { line.layout = clone(body.layout || {}); return ok(); }
  if (path === 'line/approve') {
    if (!body.force) {
      const concerns = [trialProblem(), W.samples.length < 2 ? '只在一份样例上试跑过，换一份原料不一定走得通' : '', ...warningsOf(line)].filter(Boolean);
      if (concerns.length) return fail(`批准之前请留意：${concerns.join('；')}。`, { need_force: true, concerns });
    }
    line.approved_version = line.version; line.approved_at = minute();
    return ok();
  }
  if (path === 'line/unapprove') { line.approved_version = null; line.approved_at = null; return ok(); }
  if (path === 'line/revert') {
    if (pending()) return fail('AI 的改动还没处理完。先采用或不要它，再换版本。');
    const to = body.to ?? line.version - 1;
    if (!W.versions[to]) return fail('找不到要换回的那一版');
    const nodes = clone(W.versions[to]), flow = clone(W.flows[to]);
    newVersion('你', `换回了第 ${to} 版的内容`, false);
    line.nodes = nodes; line.flow = flow;
    return ok({ version: line.version });
  }
  if (path === 'line/trial') { if (W.trial?.running && W.trial.version === line.version) return fail('正在试跑，等这一轮跑完'); runTrial(body.runs); return ok(); }
  if (path === 'line/node') {
    if (pending()) return fail('AI 的改动还没处理完。先采用或不要它，再自己改，免得两边的改动互相冲掉。');
    const node = nodeOf(line, body.id), patch = clone(body.patch || {});
    if (!node) return fail('找不到这个节点');
    if (patch.checks) {
      // an empty value means "no limit": the check is dropped
      const merged = { ...node.checks, ...patch.checks };
      for (const k of Object.keys(merged)) if (merged[k] === null || merged[k] === '' || (Array.isArray(merged[k]) && !merged[k].length)) delete merged[k];
      if (merged.min_chars != null && merged.max_chars != null && merged.min_chars > merged.max_chars) return fail('最少字数不能比最多字数大');
      patch.checks = merged;
    }
    if ('max_tries' in patch && !(patch.max_tries >= 1 && patch.max_tries <= 10)) return fail('最多写几次要填 1 到 10 之间的整数');
    for (const k of ['spec', 'points', 'criteria']) if (k in patch && !String(patch[k]).trim()) return fail('不能改成空的');
    const what = 'spec' in patch ? '规格' : 'points' in patch ? '验收要点' : 'criteria' in patch ? '合格标准' : '标准';
    newVersion('你', `你改了「${node.title}」的${what}`, false);
    Object.assign(nodeOf(line, body.id), patch);
    if (body.trial) runTrial();
    return ok({ version: line.version });
  }
  if (path === 'ai') {
    if (pending()) return fail('上一个 AI 改动还没处理完。先采用或不要它，再提新的意见。');
    const text = String(body.text || '').trim();
    if (!text) return fail('先写一句意见');
    const id = String(Date.now());
    W.proposal = { id, state: 'working', scope: body.scope || 'line', text, summary: [], trial: null, error: null, base_version: line.version, requested_at: stamp() };
    later(() => {
      const p = W.proposal;
      if (p?.id !== id) return;
      if (text.includes('失败')) { Object.assign(p, { state: 'failed', error: '样例模式：意见里带"失败"两个字时，这里演示 AI 没改成的样子。' }); return; }
      const { def, summary } = proposeLine(p.scope, text);
      const batch = trialBatch(def, W.samples.length < 2 ? 3 : 2);
      W.proposalDetails = batch.details;
      Object.assign(p, { state: 'ready', summary, line: def, trial: { runs: batch.runs, ok: batch.ok, error: null, items: batch.items, samples: batch.samples } });
    }, 5000);
    return ok({ id });
  }
  if (path === 'ai/accept') {
    const p = W.proposal;
    if (p?.state !== 'ready') return fail('AI 还没改完，或者这次没改成');
    if (p.base_version !== line.version) return fail(`AI 是照第 ${p.base_version} 版改的，可这条线后来又变成了第 ${line.version} 版。直接采用会冲掉后来的改动。请点“不要”，再把意见重新提一次。`);
    if (!body.force && p.trial.ok < p.trial.runs) {
      const concern = `AI 改完后试跑 ${p.trial.runs} 次，只走通 ${p.trial.ok} 次`;
      return fail(`采用之前请留意：${concern}。`, { need_force: true, concerns: [concern] });
    }
    // accepting approves the AI change only: a draft stays a draft
    const wasApproved = line.approved_version === line.version;
    newVersion('AI（你点头采用）', `你的意见：${p.text}。AI 改了：${p.summary.join('；')}`, wasApproved);
    line.nodes = clone(p.line.nodes); line.flow = clone(p.line.flow);
    W.trial = { version: line.version, at: stamp(), runs: p.trial.runs, ok: p.trial.ok, running: false, error: null, items: p.trial.items, samples: p.trial.samples };
    W.trialDetails = W.proposalDetails;
    W.proposal = null;
    return ok({ approved: wasApproved, version: line.version });
  }
  if (path === 'ai/reject') { W.proposal = null; return ok(); }
  if (path === 'open') return fail('样例模式下没有真的文件，打不开。');
  if (path === 'item') {
    if (line.approved_version !== line.version) return fail('这条线还是草稿。先批准这条线，批准之后才能正式投料。');
    const text = String(body.text || '');
    if (!text.trim()) return fail('原料是空的');
    const n = W.nextNumber++;
    const src = nodeOf(line, line.flow[0]);
    const it = {
      id: String(n).padStart(4, '0'), name: `第 ${n} 件`, title: String(body.title || ''), created: stamp(), line_version: line.version,
      state: 'idle', at: src.id, why: null, pid: null, nodes: { [src.id]: { state: 'done' } }, walked: [`${src.id}>${line.flow[1]}`], back: {}, round: {}, tries: {}, judged: {},
      history: [[clock(), src.title, '投料', `${chars(text)} 字`]], files: { [src.file]: text.trim() },
    };
    W.items.push(it);
    startRun(it, line.flow[1]);
    later(() => arrive(it), 5000);
    return ok({ id: it.id });
  }
  if ((m = path.match(/^item\/([^/]+)\/(decide|run|abandon|sample)$/))) {
    const draft = (what) => fail(`这条线现在是草稿（第 ${line.version} 版还没批准）。草稿不干正式的活：先批准这条线，再${what}。`);
    const approved = line.approved_version === line.version;
    const it = findItem(decodeURIComponent(m[1]));
    if (!it) return fail('找不到这件活');
    if (m[2] === 'sample') {
      const name = (it.title || it.name).slice(0, 40);
      if (W.samples.some((x) => x.name === name)) return fail(`已经有一份叫「${name}」的样例了，换个名字`);
      W.samples.push({ name, text: it.files[nodeOf(line, line.flow[0]).file] || '', kinds: [it.state === 'stopped' ? 'stuck' : 'retry', 'clean'] });
      return ok({ name });
    }
    if (m[2] === 'abandon') {
      if (it.state === 'running') return fail('这件活正在做，等它停下再放弃');
      if (it.state === 'done') return fail('这件活已经出货了');
      it.state = 'abandoned'; it.history.push([clock(), '这件活', '已放弃', '文件都保留着']);
      return ok();
    }
    if (m[2] === 'decide') {
      const gate = nodeOf(line, body.node);
      if (it.state !== 'waiting' || it.at !== body.node) return fail('这件活现在不在等这道门的验收');
      const reason = String(body.reason || '').trim();
      const ships = body.approve && nodeOf(line, line.flow[line.flow.indexOf(gate.id) + 1])?.kind === 'product';
      if (!ships && !approved) return draft(body.approve ? '让这件活继续往后走' : '退回重写');
      if (!body.approve && !reason) return fail('不合格要写一句理由，不然它不知道该怎么改');
      const list = it.tries[gate.on_fail] || [];
      if (list.length) list[list.length - 1].verdict = body.approve ? '你验收合格' : `你验收不合格：${reason}`;
      const judged = (it.judged[gate.id] = it.judged[gate.id] || []);
      if (body.approve) {
        const next = line.flow[line.flow.indexOf(gate.id) + 1];
        judged.push(`${clock()} 你判了合格`);
        it.nodes[gate.id] = { state: 'pass' }; it.nodes[next] = { state: 'done' };
        it.walked.push(`${gate.id}>${next}`); it.state = 'done'; it.at = next;
        it.history.push([clock(), gate.title, '合格', '你点了“合格，出货”'], [clock(), nodeOf(line, next).title, '已出货', nodeOf(line, next).file]);
        return ok({ next });
      }
      judged.push(`${clock()} 你判了不合格：${reason}`);
      it.history.push([clock(), gate.title, '不合格，退回', reason]);
      const key = `${gate.id}>${gate.on_fail}`;
      it.back[key] = (it.back[key] || 0) + 1;
      it.round[gate.on_fail] = 0; // a human send-back starts a fresh round
      startRun(it, gate.on_fail);
      it.nodes[gate.id] = { state: 'fail' };
      it.walked.push(key);
      later(() => arrive(it), 4000);
      return ok({ next: gate.on_fail });
    }
    if (!approved) return draft('重做这件活');
    const from = nodeOf(line, body.from);
    if (!from || from.kind === 'source' || from.kind === 'product') return fail('只能从某一站或某一道门开始重做');
    if (it.state === 'running') return fail('这件活正在做，等它停下再说');
    if (it.state === 'done' || it.state === 'abandoned') return fail('这件活已经结束了。想重做请重新投料，免得盖掉成品');
    it.history.push([clock(), from.title, '重做', '你要求从这一步重新开始']);
    it.round = {}; // a manual rerun starts a fresh round
    startRun(it, body.from);
    later(() => arrive(it, !!body.only), 4000);
    return ok();
  }
  return fail(`样例模式不认识这个接口：${path}`);
}

export async function mockRequest(method, path, body) {
  await new Promise((r) => setTimeout(r, 120));
  if (method !== 'GET') return post(path, body || {});
  if (path === 'state') return { ok: true, line: publicLine(), items: W.items.map(summaryOf), lines: publicLines(), now: stamp() };
  let m;
  if ((m = path.match(/^item\/(.+)$/))) {
    const it = findItem(decodeURIComponent(m[1]));
    return it ? { ok: true, ...detailOf(it) } : fail('找不到这件活');
  }
  if ((m = path.match(/^(trial|proposal)\/item\/(.+)$/))) {
    const it = (m[1] === 'trial' ? W.trialDetails : W.proposalDetails)[decodeURIComponent(m[2])];
    return it ? { ok: true, ...detailOf(it, true) } : fail('找不到这次试跑的活');
  }
  return fail(`样例模式不认识这个接口：${path}`);
}
