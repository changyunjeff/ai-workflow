// Pure helpers that turn line.json / status.json shapes into what the page draws.
// Field names follow docs/05-产线文件与接口.md.

export const STOP_ID = 'stop';
export const STOP_NODE = { id: STOP_ID, kind: 'stop', title: '停下等你处理' };
export const NODE_H = 62;

// node state -> [text, css class]
export const ST = {
  done: ['做完', 'ok'],
  pass: ['合格', 'ok'],
  run: ['正在做', 'run'],
  wait: ['等你验收', 'wait'],
  fail: ['不合格', 'bad'],
  stopped: ['停在这里', 'bad'],
  idle: ['没轮到', ''],
};

// whole-item state -> [fallback text, chip css class]
export const ITEM_ST = {
  running: ['正在做', 'run'],
  waiting: ['等你验收', 'wait'],
  stopped: ['停线', 'bad'],
  done: ['已出货', 'ok'],
  abandoned: ['已放弃', ''],
  idle: ['停着', ''],
};

export const cx = (...parts) => parts.filter(Boolean).join(' ');

export const isGate = (n) => n?.kind === 'gate';
export const isMachineGate = (n) => isGate(n) && n.judge === 'machine';
export const isAiGate = (n) => isGate(n) && n.judge === 'ai';
// machine and AI gates judge by themselves: they send back, and stop the item at the limit
export const isAutoGate = (n) => isMachineGate(n) || isAiGate(n);
export const isHumanGate = (n) => isGate(n) && !isAutoGate(n);
export const judgeName = (n) => (isMachineGate(n) ? '机器判' : isAiGate(n) ? 'AI 判' : '你来判');

export function kindClass(n) {
  if (n.kind === 'source' || n.kind === 'product') return 'file';
  if (n.kind === 'gate') return isMachineGate(n) ? 'mgate' : isAiGate(n) ? 'agate' : 'hgate';
  if (n.kind === 'stop') return 'stop';
  return 'station';
}

export function kindName(n) {
  if (n.kind === 'source') return '原料';
  if (n.kind === 'product') return '成品';
  if (n.kind === 'gate') return `门 · ${judgeName(n)}`;
  if (n.kind === 'stop') return '停线';
  return '站';
}

export const nodeWidth = (n) => (kindClass(n) === 'file' ? 84 : 108);

// Nodes in flow order, then any node missing from flow, then the fixed stop node.
export function orderedNodes(line) {
  const byId = new Map((line.nodes || []).map((n) => [n.id, n]));
  const out = [];
  for (const id of line.flow || []) {
    const n = byId.get(id);
    if (n) { out.push(n); byId.delete(id); }
  }
  for (const n of byId.values()) if (n.id !== STOP_ID) out.push(n);
  out.push(STOP_NODE);
  return out;
}

export function nodeById(line, id) {
  if (id === STOP_ID) return STOP_NODE;
  return (line.nodes || []).find((n) => n.id === id) || null;
}

export const titleOf = (line, id) => nodeById(line, id)?.title || id;

export function nextInFlow(line, id) {
  const flow = line.flow || [];
  const i = flow.indexOf(id);
  return i >= 0 && i + 1 < flow.length ? nodeById(line, flow[i + 1]) : null;
}

// A station is "ungated" when the next node in flow is not a gate.
export function hasNoGate(line, node) {
  return node.kind === 'station' && !isGate(nextInFlow(line, node.id));
}

// The run of gates that directly follows a station.
export function gatesAfter(line, node) {
  const flow = line.flow || [];
  const out = [];
  for (let i = flow.indexOf(node.id) + 1; i > 0 && i < flow.length; i++) {
    const n = nodeById(line, flow[i]);
    if (!isGate(n)) break;
    out.push(n);
  }
  return out;
}

// Default placement: main line in one row left to right, stop below-right of the first machine gate.
export function defaultLayout(line) {
  const pos = {};
  const y = 150;
  let x = 14;
  const nodes = orderedNodes(line).filter((n) => n.id !== STOP_ID);
  for (const n of nodes) {
    pos[n.id] = [x, y];
    x += nodeWidth(n) + 42;
  }
  pos[STOP_ID] = stopHome(line, pos) || [Math.max(14, Math.round((x - 42) / 2 - 54)), y + 168];
  return pos;
}

// Where the stop node goes by default: to the right of the last gate that can stop an item,
// just below the lane that collects all the "gave up" edges.
function stopHome(line, pos) {
  const gates = orderedNodes(line).filter(isAutoGate);
  const last = gates[gates.length - 1];
  if (!last) return null;
  return [pos[last.id][0] + 60, pos[last.id][1] + NODE_H + stopLaneDepth(line) + 30];
}

const validPos = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v));

// Saved positions win; anything missing falls back to the default placement.
// When most of the row was placed by hand and a node is unknown to the saved layout (the AI
// added it), the new node takes the slot right after its predecessor and later nodes move right.
export function effectiveLayout(line, saved) {
  const pos = defaultLayout(line);
  const has = (id) => validPos(saved?.[id]);
  const row = orderedNodes(line).filter((n) => n.id !== STOP_ID);
  const known = row.filter((n) => has(n.id)).length;
  if (known === row.length || known < row.length / 2) {
    for (const [id, p] of Object.entries(saved || {})) {
      if (id in pos && validPos(p)) pos[id] = [p[0], p[1]];
    }
    return pos;
  }
  const autos = row.filter(isAutoGate);
  const firstMachine = autos[autos.length - 1];
  let shift = 0, prev = null, stopShift = 0;
  for (const n of row) {
    if (has(n.id)) pos[n.id] = [saved[n.id][0] + shift, saved[n.id][1]];
    else {
      if (prev) pos[n.id] = [pos[prev.id][0] + nodeWidth(prev) + 42, pos[prev.id][1]];
      shift += nodeWidth(n) + 42;
    }
    if (n === firstMachine) stopShift = shift;
    prev = n;
  }
  if (has(STOP_ID)) pos[STOP_ID] = [saved[STOP_ID][0] + stopShift, saved[STOP_ID][1]];
  else pos[STOP_ID] = stopHome(line, pos) || pos[STOP_ID];
  return pos;
}

// Which nodes of `next` differ from `base`: id -> '新加' | '改过'. Also lists removed nodes.
export function lineChanges(base, next) {
  const before = new Map((base.nodes || []).map((n) => [n.id, JSON.stringify(n)]));
  const marks = {};
  for (const n of next.nodes || []) {
    if (!before.has(n.id)) marks[n.id] = '新加';
    else if (before.get(n.id) !== JSON.stringify(n)) marks[n.id] = '改过';
  }
  const kept = new Set((next.nodes || []).map((n) => n.id));
  const removed = (base.nodes || []).filter((n) => !kept.has(n.id));
  return { marks, removed };
}

// The user's most recent "not good enough" reason at a human gate, from item.judged[gate].
export function lastRejectReason(judged) {
  for (let i = (judged || []).length - 1; i >= 0; i--) {
    const m = /你判了不合格：([\s\S]*)$/.exec(String(judged[i]));
    if (m) return m[1].trim();
  }
  return '';
}

// A trial run "went through" when it reached a human gate or the product.
export const trialWentThrough = (it) => it.state === 'waiting' || it.state === 'done';

export const sameLayout = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => b[k] && a[k][0] === b[k][0] && a[k][1] === b[k][1]);
};

// Edges are derived, never stored:
//   flow neighbours        -> forward (solid)
//   gate.on_fail           -> back (dashed); machine gates route below the row, human gates above
//   machine or AI gate -> stop -> stop (dotted), all sharing one lane below the back lanes
// Back edges on the same side get nested lanes (shorter span = closer to the row) so they never overlap.
export function buildEdges(line) {
  const flow = (line.flow || []).filter((id) => nodeById(line, id));
  const edges = [];
  for (let i = 0; i + 1 < flow.length; i++) {
    const a = nodeById(line, flow[i]);
    edges.push({ key: `${flow[i]}>${flow[i + 1]}`, source: flow[i], target: flow[i + 1], kind: 'fwd', label: isGate(a) ? '合格' : '' });
  }
  const backs = [];
  for (const g of line.nodes || []) {
    if (!isGate(g)) continue;
    if (g.on_fail && nodeById(line, g.on_fail)) {
      const machine = isAutoGate(g);
      backs.push({
        key: `${g.id}>${g.on_fail}`, source: g.id, target: g.on_fail, kind: 'back',
        side: machine ? 'below' : 'above',
        label: machine ? '不合格，退回重写' : '不合格，带理由退回',
        span: Math.abs(flow.indexOf(g.id) - flow.indexOf(g.on_fail)),
      });
    }
    if (isAutoGate(g)) {
      edges.push({
        key: `${g.id}>${STOP_ID}`, source: g.id, target: STOP_ID, kind: 'stop',
        label: g.max_tries ? `写了 ${g.max_tries} 次仍不合格` : '重写到上限仍不合格',
      });
    }
  }
  let deepest = 0;
  for (const side of ['below', 'above']) {
    const lanes = []; // per lane: the [lo, hi] stretches of the row already taken
    backs.filter((b) => b.side === side).sort((a, b) => a.span - b.span).forEach((b) => {
      const lo = Math.min(flow.indexOf(b.source), flow.indexOf(b.target)), hi = Math.max(flow.indexOf(b.source), flow.indexOf(b.target));
      let i = lanes.findIndex((taken) => taken.every(([l, h]) => hi < l || lo > h));
      if (i < 0) { lanes.push([]); i = lanes.length - 1; }
      lanes[i].push([lo, hi]);
      const depth = 40 + i * 26;
      if (side === 'below') deepest = Math.max(deepest, depth);
      edges.push({ ...b, depth });
    });
  }
  // every "gave up" edge drops to one shared lane below all the back lanes
  for (const e of edges) if (e.kind === 'stop') e.depth = deepest + 44;
  return edges;
}

// How far below the row the shared lane to the stop node runs.
export function stopLaneDepth(line) {
  return buildEdges(line).find((e) => e.kind === 'stop')?.depth ?? 84;
}

// State of one node for one item. Nodes absent from item.nodes are "idle", except the three
// the engine never visits as steps: the source (always there), the product and the stop node.
export function nodeState(node, item) {
  if (!item) return 'idle';
  const s = item.nodes?.[node.id]?.state;
  if (s && ST[s]) return s;
  if (node.kind === 'source') return 'done';
  if (node.kind === 'product') return item.state === 'done' ? 'done' : 'idle';
  if (node.id === STOP_ID) return item.state === 'stopped' ? 'stopped' : 'idle';
  return 'idle';
}

// "第 12 件" plus the optional name the user gave it when feeding.
export function itemLabel(item) {
  const title = String(item.title || '').trim();
  if (!title) return item.name;
  return `${item.name}「${title.length > 10 ? `${title.slice(0, 10)}…` : title}」`;
}

// Words for a node state; a gate that is busy is judging, not making.
export const stateText = (node, state) => (state === 'run' && isGate(node) ? '正在判' : ST[state][0]);

export const itemStateName = (item) => item.state_name || ITEM_ST[item.state]?.[0] || item.state || '';

// How many live items sit on each node (abandoned ones are not counted).
export function countByNode(items) {
  const counts = {};
  for (const it of items || []) {
    if (it.state === 'abandoned' || !it.at) continue;
    counts[it.at] = (counts[it.at] || 0) + 1;
  }
  return counts;
}

// "3 份样例共 9 次，走通 8 次": the honest pass rate of a trial ({runs, ok, samples?}).
export function passRate(t) {
  const n = t.samples?.length || 0;
  return `${n ? `${n} 份样例共 ` : ''}${t.runs} 次，走通 ${t.ok} 次`;
}

// good: every run went through; bad: none did; warn: some did not.
export const passTone = (t) => (t.error || t.ok <= 0 ? 'bad' : t.ok < t.runs ? 'warn' : 'good');

// One line per sample: "样例「短会」：3 次，走通 2 次".
export const passDetail = (t) => (t.samples || []).map((s) => `样例「${s.name}」：${s.runs} 次，走通 ${s.ok} 次`);

// The trial evidence of the current version: { text, tone, detail[] }.
export function trialSummary(line) {
  const t = line.trial;
  if (!t) return { text: '这一版还没试跑过', tone: 'none', detail: [] };
  if (t.running) {
    const done = t.items?.length || 0;
    return { text: `正在试跑……${t.runs ? `（跑完了 ${done} / ${t.runs} 次）` : ''}`, tone: 'none', detail: passDetail(t) };
  }
  if (t.error) return { text: `这一版试跑没跑成：${t.error}`, tone: 'bad', detail: [] };
  if (t.version !== line.version) return { text: `这一版还没试跑过（上次试跑的是第 ${t.version} 版：${passRate(t)}）`, tone: 'none', detail: [] };
  return { text: `第 ${t.version} 版试跑：${passRate(t)}`, tone: passTone(t), detail: passDetail(t) };
}

export const trialText = (line) => trialSummary(line).text;

// Trial runs grouped by sample, the worrying ones first: not through, then sent back on the way, then clean.
const runRank = (it) => (!trialWentThrough(it) ? 0 : it.back > 0 ? 1 : 2);
export function groupTrialRuns(items) {
  const groups = new Map();
  for (const it of items || []) {
    const key = it.sample || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return [...groups.entries()]
    .map(([sample, runs]) => ({ sample, runs: [...runs].sort((a, b) => runRank(a) - runRank(b)) }))
    .sort((a, b) => runRank(a.runs[0]) - runRank(b.runs[0]));
}
export const runTone = (it) => ['bad', 'wait', 'ok'][runRank(it)];

// "2026-11-15 01:34:08" (local time) -> Date
export const parseStamp = (s) => (s ? new Date(String(s).replace(' ', 'T')) : null);

export function fmtElapsed(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

// Gates that really checked the file a human gate is about to accept: same file, earlier in the row.
export function gatesBefore(line, gate) {
  const flow = line.flow || [];
  return flow.slice(0, Math.max(0, flow.indexOf(gate.id))).map((id) => nodeById(line, id))
    .filter((n) => isAutoGate(n) && n.file === gate.file);
}

export const isApproved = (line) => line.approved_version != null && line.approved_version === line.version;

// "2026-11-14 22:29" -> "今天 22:29" when it is today, otherwise unchanged.
export function fmtTime(ts, today) {
  if (!ts) return '';
  const s = String(ts);
  if (today && s.slice(0, 10) === today) return `今天 ${s.slice(11, 16)}`;
  return s.slice(0, 16);
}

export function fmtDuration(seconds) {
  if (!Number.isFinite(seconds)) return '';
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`;
}

// "提要点 → 写摘要 → 机器查字数和格式 → 你验收 → 成品"
export function flowSentence(line) {
  return (line.flow || []).map((id) => nodeById(line, id)).filter((n) => n && n.kind !== 'source').map((n) => {
    if (n.kind === 'product') return '成品';
    if (isMachineGate(n)) return `机器查${n.title}`;
    if (isAiGate(n)) return `AI 查${n.title}`;
    if (isGate(n)) return `你${n.title}`;
    return n.title;
  }).join(' → ');
}

// Human name for a file inside an item folder.
export function fileLabel(line, name) {
  for (const n of line.nodes || []) {
    if (n.kind === 'source' && n.file === name) return `原料（${n.title}）`;
    if (n.kind === 'station' && n.output === name) return `「${n.title}」的产出`;
  }
  return `文件 ${name}`;
}

// Review order for items: waiting first, then stopped, running, everything else.
export const itemGroup = (it) => (it.state === 'waiting' ? 'wait' : it.state === 'stopped' ? 'stop' : it.state === 'running' ? 'run' : 'other');
const GROUP_RANK = { wait: 0, stop: 1, run: 2, other: 3 };

export function sortItems(items) {
  const key = (it) => String(it.created || it.id || '');
  return [...items].sort((a, b) => {
    const ga = itemGroup(a), gb = itemGroup(b);
    if (ga !== gb) return GROUP_RANK[ga] - GROUP_RANK[gb];
    // queues (waiting, stopped) oldest first; the rest newest first
    return ga === 'wait' || ga === 'stop' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a));
  });
}

export const pickDefaultItem = (items) => sortItems(items || [])[0] || null;
