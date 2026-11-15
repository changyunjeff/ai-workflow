import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, IS_MOCK } from './api.js';
import {
  countByNode, cx, defaultLayout, effectiveLayout, groupTrialRuns, isApproved, itemLabel, lineChanges, nodeById, pickDefaultItem,
  sameLayout, sortItems,
} from './graph.js';
import Clamp from './Clamp.jsx';
import SamplesDialog from './SamplesDialog.jsx';
import Canvas from './Canvas.jsx';
import FeedDialog from './FeedDialog.jsx';
import Panel from './Panel.jsx';
import { AskBox, Header, ItemPicker, ModeBar, ProposalBanner } from './TopBar.jsx';

const POLL_MS = 1500;
const NO_COUNTS = {};
const NO_REMOVED = [];

// The page has three views. 'live' shows the real items. 'trial' shows the runs of the current
// version's latest trial, and 'proposal' shows the AI's changed line with its trial runs; both
// are read-only.
const itemsOf = (view, st) => (view === 'trial' ? st.line.trial?.items : view === 'proposal' ? st.line.proposal?.trial?.items : st.items) || [];
const lineOf = (view, line) => (view === 'proposal' && line.proposal?.line ? line.proposal.line : line);
const viewAlive = (view, line) => view === 'live' || (view === 'trial' ? !!line.trial : line.proposal?.state === 'ready' && !!line.proposal.line);
// in a trial the most worrying run comes first: not through, then sent back on the way
const firstOf = (view, list) => (view === 'live' ? pickDefaultItem(list) : groupTrialRuns(list)[0]?.runs[0] || null);

function HistoryLog({ item, detailLoaded, readonly }) {
  if (!item) return <div className="card log"><h2>经过</h2><p className="hint">{readonly ? '上面选一次试跑，这里显示它的经过。' : '还没有投过料。'}</p></div>;
  const rows = item.history || [];
  return (
    <div className="card log">
      <h2>{itemLabel(item)}的经过</h2>
      {!detailLoaded ? <p className="hint">正在读取……</p> : rows.length === 0 ? <p className="hint">还没有记录。</p> : (
        <table>
          <tbody>
            {rows.map((r, i) => <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td><Clamp text={r[3]} limit={90} /></td></tr>)}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Legend({ canArrange, onTidy, onUndo }) {
  return (
    <div className="legend">
      <span><i className="sw" />站：干一步活</span>
      <span><i className="sw" style={{ borderRadius: 8 }} />门：检查上一步的产出：机器判、AI 判或你来判</span>
      <span><i className="sw" style={{ borderStyle: 'dashed' }} />原料 / 成品</span>
      <span><i className="sw" style={{ background: 'var(--green-bg)', borderColor: 'var(--green)' }} />做完或合格</span>
      <span><i className="sw" style={{ background: 'var(--blue-bg)', borderColor: 'var(--blue)' }} />正在做</span>
      <span><i className="sw" style={{ background: 'var(--amber-bg)', borderColor: 'var(--amber)' }} />等你</span>
      <span><i className="sw" style={{ background: 'var(--red-bg)', borderColor: 'var(--red)' }} />出问题</span>
      <span>
        实线往前走，虚线是退回，点线是停线。
        {canArrange ? '按住节点可拖动摆放，位置会记住。' : '预览时节点不能拖动。'}
        按住空白处拖动可平移；缩放用左下角的 + 和 −，或按住 Ctrl 滚滚轮。
      </span>
      {canArrange && <button className="link" onClick={onTidy}>恢复默认摆放</button>}
      {canArrange && onUndo && <button className="link" onClick={onUndo}>撤销恢复</button>}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);          // { line, items, today } from GET api/state
  const [detail, setDetail] = useState(null);      // the current item (or trial run) in full
  const [view, setView] = useState('live');        // 'live' | 'trial' | 'proposal'
  const [cur, setCur] = useState(null);            // current item id within the view
  const [sel, setSel] = useState(null);            // selected node id, null = line description
  const [tab, setTab] = useState('item');
  const [offline, setOffline] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);        // { msg, err, on }
  const [localLayout, setLocalLayout] = useState(null);
  const [undoLayout, setUndoLayout] = useState(null);
  const [fitToken, setFitToken] = useState(0);
  const [feedOpen, setFeedOpen] = useState(false);
  const [samplesOpen, setSamplesOpen] = useState(false);

  const curRef = useRef(null);
  const viewRef = useRef('live');
  const liveCur = useRef(null);   // the real item to come back to after a read-only view
  const pendingSel = useRef(null); // item id whose node should be selected once its detail arrives
  const selRef = useRef(null);
  selRef.current = sel;
  const tabRef = useRef('item');
  tabRef.current = tab;
  const dataRef = useRef(null);
  const dataSig = useRef('');
  const detailSig = useRef('');
  const epoch = useRef(0);        // bumped around every change so stale poll answers are dropped
  const busyRef = useRef(false);
  const dirty = useRef({});       // unsaved-input flags reported by the panel
  const toastTimer = useRef(0);
  const refreshRef = useRef(null);

  const showToast = useCallback((msg, err = false) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, err, on: true });
    toastTimer.current = setTimeout(() => setToast((t) => (t ? { ...t, on: false } : t)), err ? 9000 : 5200);
  }, []);

  const hasUnsaved = () => Object.values(dirty.current).some(Boolean);

  const leaveOk = useCallback(() => {
    if (!hasUnsaved()) return true;
    return window.confirm('刚才改的还没保存，离开会丢。要离开吗？');
  }, []);

  const applyDetail = (d) => {
    const sig = JSON.stringify(d);
    if (sig === detailSig.current) return;
    detailSig.current = sig;
    setDetail(d);
  };

  // Back to the real items (state only; the caller refreshes).
  const resetToLive = useCallback(() => {
    if (viewRef.current === 'live') return;
    viewRef.current = 'live';
    const id = liveCur.current;
    const st = dataRef.current;
    const it = st?.items.find((x) => x.id === id);
    curRef.current = it ? id : null;
    detailSig.current = '';
    pendingSel.current = null;
    setView('live');
    setCur(curRef.current);
    setDetail(null);
    setSel(it && nodeById(st.line, it.at) ? it.at : null);
    setTab('item');
    setFitToken((t) => t + 1);
  }, []);

  // Forget everything that belongs to one line: the view, the item, the node, pending layout.
  const resetSelection = useCallback(() => {
    viewRef.current = 'live';
    curRef.current = null;
    liveCur.current = null;
    pendingSel.current = null;
    detailSig.current = '';
    setView('live');
    setCur(null);
    setDetail(null);
    setSel(null);
    setTab('item');
    setLocalLayout(null);
    setUndoLayout(null);
    setFeedOpen(false);
    setSamplesOpen(false);
    setFitToken((t) => t + 1);
  }, []);

  const refresh = useCallback(async () => {
    const started = epoch.current;
    const v = viewRef.current;
    const wanted = curRef.current;
    const stale = () => started !== epoch.current || v !== viewRef.current;
    try {
      let itemError = '';
      const fetchItem = v === 'trial' ? api.trialItem : v === 'proposal' ? api.proposalItem : api.item;
      const readItem = (itemId) => fetchItem(itemId).catch((e) => { itemError = `读不到这件活的详情：${e.message}`; return undefined; });
      const [st, got] = await Promise.all([api.state(), wanted ? readItem(wanted) : null]);
      if (stale()) return;
      const lines = st.lines || [];
      const lineKey = lines.find((l) => l.current)?.id ?? st.line.id;
      const next = { line: st.line, items: st.items || [], lines, lineKey, today: String(st.now || '').slice(0, 10) };
      const movedLine = !!dataRef.current && dataRef.current.lineKey !== lineKey;
      const sig = JSON.stringify(next);
      if (sig !== dataSig.current) { dataSig.current = sig; dataRef.current = next; setData(next); }
      if (movedLine && (curRef.current || v !== 'live')) {
        // the service now serves another line (switched in another window): start clean on it
        resetSelection();
        refreshRef.current();
        return;
      }
      if (!viewAlive(v, st.line)) {
        // the trial or the AI change being looked at is gone (new version, accepted, dismissed)
        resetToLive();
        if (v === 'trial') showToast('这条线换了版本，刚才看的试跑记录不算数了，已回到正式的活。');
        refreshRef.current();
        return;
      }
      const list = itemsOf(v, st);
      const shown = lineOf(v, st.line);
      let nextDetail = wanted === curRef.current ? got : undefined;
      const id = curRef.current;
      if (!id || !list.some((it) => it.id === id)) {
        // first load, or the current item vanished: fall back to the most urgent one
        const first = firstOf(v, list);
        const firstId = first ? first.id : null;
        itemError = '';
        nextDetail = firstId ? await readItem(firstId) : null;
        if (stale() || curRef.current !== id) return;
        if (firstId !== id) {
          curRef.current = firstId;
          setCur(firstId);
          if (!hasUnsaved()) {
            const at = first?.at ?? nextDetail?.at;
            setSel(at && nodeById(shown, at) ? at : null);
            setTab('item');
          }
        }
      }
      if (nextDetail !== undefined) {
        applyDetail(nextDetail);
        if (nextDetail && pendingSel.current === nextDetail.id) {
          pendingSel.current = null;
          setSel(nodeById(shown, nextDetail.at) ? nextDetail.at : null);
        }
      }
      setOffline(itemError);
    } catch (e) {
      if (!stale()) setOffline(e.message || '连不上本机服务。');
    }
  }, [resetToLive, resetSelection, showToast]);
  refreshRef.current = refresh;

  // poll every 1.5 s; the next poll is scheduled only after the previous one has answered
  useEffect(() => {
    let stopped = false, timer = 0;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [refresh]);

  // Run one change against the service, show its error verbatim, then refresh right away.
  // okMsg may be a function of the answer. With askForce, a {need_force: true} refusal is
  // handed back to the caller (who asks the user) instead of being shown as an error.
  const act = useCallback(async (call, okMsg, { background = false, askForce = false } = {}) => {
    if (!background) {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
    }
    epoch.current++;
    let res;
    try { res = await call(); } catch (e) { res = { ok: false, error: e.message }; }
    epoch.current++;
    const ok = !!res && res.ok !== false;
    const wantsForce = !ok && askForce && res && res.need_force;
    if (!ok && !wantsForce) showToast((res && res.error) || '操作没有成功，服务没有说原因。', true);
    else if (ok && okMsg) showToast(typeof okMsg === 'function' ? okMsg(res) : okMsg);
    await refresh();
    if (!background) { busyRef.current = false; setBusy(false); }
    return ok || wantsForce ? res : null;
  }, [refresh, showToast]);

  // Approve / accept: the service may answer "are you sure?" with a list of concerns.
  const withForce = useCallback(async (send, okMsg, lead, question) => {
    const res = await act(() => send(false), okMsg, { askForce: true });
    if (!res || res.ok !== false) return res;
    const concerns = res.concerns && res.concerns.length ? res.concerns : [res.error];
    if (!window.confirm(`${lead}\n\n${concerns.map((c) => `· ${c}`).join('\n')}\n\n${question}`)) return null;
    return act(() => send(true), okMsg);
  }, [act]);

  const approve = useCallback(() => withForce(
    api.approve, '已批准，现在可以投料。以后每改一版，都要重新批准。',
    '批准之前请留意：', '批准之后就能正式投料。仍然要批准这条线吗？',
  ), [withForce]);

  // accepting approves the AI's change only: a line that was a draft before stays a draft
  const acceptAi = useCallback(() => withForce(
    api.aiAccept,
    (res) => (res.approved === false
      ? `已采用，成为第 ${res.version} 版。这条线仍是草稿：之前还有没批准的改动，批准后才能投料。`
      : res.version != null ? `已采用，成为第 ${res.version} 版，可以投料。` : '已采用，新版替换了原来的版本。'),
    '采用之前请留意：', '采用之后新版马上替换现在的版本。仍然要采用 AI 的改动吗？',
  ), [withForce]);

  const liveLine = data?.line || null;
  const items = data?.items || [];
  const proposal = liveLine?.proposal || null;
  const line = useMemo(() => {
    if (!liveLine) return null;
    const shown = lineOf(view, liveLine);
    return shown === liveLine ? shown : { ...shown, worker_name: liveLine.worker_name };
  }, [view, liveLine]);
  const list = data ? itemsOf(view, data) : items;
  const summary = list.find((it) => it.id === cur) || null;
  const detailLoaded = !!detail && detail.id === cur;
  const readonly = view !== 'live';
  // a trial run's own status calls itself "第 1 件"; show the name the trial list gives it
  const item = useMemo(
    () => (!detailLoaded ? summary : readonly && summary?.name ? { ...detail, name: summary.name } : detail),
    [detailLoaded, detail, summary, readonly],
  );
  const counts = useMemo(() => (view === 'live' ? countByNode(items) : NO_COUNTS), [view, items]);
  const layout = useMemo(() => (line ? effectiveLayout(line, localLayout || liveLine.layout) : null), [line, liveLine, localLayout]);
  const changes = useMemo(() => (view === 'proposal' && line !== liveLine ? lineChanges(liveLine, line) : null), [view, line, liveLine]);

  // Follow the item: while the panel is showing the node the item sits on, move along with it
  // (e.g. from a running station to the gate that is waiting for the user). Never while typing.
  const follow = useRef({ id: null, at: null });
  const itemId = item?.id ?? null;
  const itemAt = item?.at ?? null;
  useEffect(() => {
    const prev = follow.current;
    follow.current = { id: itemId, at: itemAt };
    if (viewRef.current !== 'live') return;
    if (!itemId || prev.id !== itemId || !prev.at || !itemAt || prev.at === itemAt) return;
    if (selRef.current !== prev.at || tabRef.current !== 'item') return;
    if (hasUnsaved()) return;
    if (dataRef.current && nodeById(dataRef.current.line, itemAt)) setSel(itemAt);
  }, [itemId, itemAt]);

  const switchItem = useCallback((id) => {
    curRef.current = id;
    detailSig.current = '';
    setCur(id);
    setDetail(null);
    setTab('item');
    if (viewRef.current === 'live') {
      const st = dataRef.current;
      const it = st?.items.find((x) => x.id === id);
      setSel(it && nodeById(st.line, it.at) ? it.at : null);
    } else {
      pendingSel.current = id; // trial lists do not say where a run ended; wait for its detail
    }
    refresh();
  }, [refresh]);

  const pickItem = useCallback((id) => {
    if (id === curRef.current || !leaveOk()) return;
    switchItem(id);
  }, [leaveOk, switchItem]);

  // After a verdict at a human gate: jump to the waiting item that was fed earliest, if any.
  const afterDecide = useCallback((decided, msg) => {
    const others = sortItems((dataRef.current?.items || []).filter((it) => it.state === 'waiting' && it.id !== decided.id));
    if (!others.length) { showToast(msg); return; }
    switchItem(others[0].id);
    showToast(`${msg}已切到下一件待验收：${itemLabel(others[0])}。`);
  }, [showToast, switchItem]);

  const switchLine = useCallback(async (target) => {
    if (target.current || !leaveOk()) return;
    resetSelection();
    await act(() => api.switchLine(target.id), `已切到「${target.name}」。`);
  }, [act, leaveOk, resetSelection]);

  const enterView = useCallback((next) => {
    if (viewRef.current === next || !leaveOk()) return;
    if (viewRef.current === 'live') liveCur.current = curRef.current;
    viewRef.current = next;
    curRef.current = null;
    detailSig.current = '';
    pendingSel.current = null;
    setView(next);
    setCur(null);
    setDetail(null);
    setSel(null);
    setTab('item');
    setFitToken((t) => t + 1);
    refresh();
  }, [leaveOk, refresh]);

  const exitView = useCallback(() => {
    resetToLive();
    refresh();
  }, [resetToLive, refresh]);

  const app = useMemo(() => ({
    act, busy, toast: showToast, leaveOk, dirty, approve, acceptAi, afterDecide,
    view, readonly,
    // a draft never does real work: reruns and send-backs wait until the line is approved
    draft: !!liveLine && !isApproved(liveLine),
    baseLine: liveLine,
    proposal,
    aiPending: !!proposal && (proposal.state === 'working' || proposal.state === 'ready'),
    today: data?.today || '',
  }), [act, busy, showToast, leaveOk, approve, acceptAi, afterDecide, view, readonly, liveLine, proposal, data?.today]);

  const selectNode = useCallback((id) => {
    if (id !== selRef.current && !leaveOk()) return;
    setSel(id);
  }, [leaveOk]);

  const changeTab = (next) => {
    if (next === tab || !leaveOk()) return;
    setTab(next);
  };

  // Positions are shown at once and then saved; the server copy takes over after the save.
  const saveLayout = useCallback(async (next) => {
    setLocalLayout(next);
    await act(() => api.saveLayout(next), null, { background: true });
    setLocalLayout((l) => (l === next ? null : l));
  }, [act]);

  const onLayoutChange = useCallback((next) => {
    if (viewRef.current === 'proposal') return;
    const now = dataRef.current && effectiveLayout(dataRef.current.line, dataRef.current.line.layout);
    if (now && sameLayout(now, next)) return;
    setUndoLayout(null);
    saveLayout(next);
  }, [saveLayout]);

  const tidy = () => {
    const home = defaultLayout(line);
    setFitToken((t) => t + 1);
    if (sameLayout(home, layout)) return;
    setUndoLayout(layout);
    saveLayout(home);
  };

  const undoTidy = () => {
    saveLayout(undoLayout);
    setUndoLayout(null);
    setFitToken((t) => t + 1);
  };

  const openFeed = () => {
    if (!isApproved(liveLine)) { showToast('这条线还是草稿，不能投料。先点"批准这条线"，批准之后才能正式投料。'); return; }
    if (!leaveOk()) return;
    setFeedOpen(true);
  };

  const feed = async (text, title) => {
    const before = new Set(items.map((it) => it.id));
    const res = await act(() => api.feed(text, title), '已投料，开始做了。');
    if (!res) return;
    setFeedOpen(false);
    resetToLive();
    const id = res.id || (dataRef.current?.items || []).find((it) => !before.has(it.id))?.id;
    if (id) switchItem(String(id)); else refresh();
  };

  const showAbout = () => { if (sel === null || leaveOk()) setSel(null); };
  const closeFeed = useCallback(() => setFeedOpen(false), []);
  const closeSamples = useCallback(() => setSamplesOpen(false), []);

  const notice = IS_MOCK
    ? <div className="demo">现在看的是内置的样例数据（网址里带了 mock=1），没有连本机服务。按钮只在这个页面里模拟一下效果，刷新就还原。</div>
    : offline ? <div className="demo offline">{offline} 页面会自动重试；下面显示的是上一次读到的内容。</div> : null;

  if (!line) {
    return (
      <>
        {notice}
        <div className="loading">{offline ? '还没读到这条线。' : '正在读取这条线……'}</div>
      </>
    );
  }

  return (
    <>
      {notice}
      {readonly && <ModeBar view={view} line={liveLine} removed={changes?.removed || NO_REMOVED} onExit={exitView} />}
      <Header
        app={app} line={liveLine} lines={data.lines} view={view}
        onAbout={showAbout} onFeed={openFeed} onViewTrial={() => enterView('trial')} onSwitchLine={switchLine}
        onSamples={() => setSamplesOpen(true)}
      />
      <ItemPicker view={view} items={list} cur={cur} onPick={pickItem} running={view === 'trial' && !!liveLine.trial?.running} />
      {!readonly && <AskBox app={app} />}
      <ProposalBanner app={app} line={liveLine} view={view} onPreview={() => enterView('proposal')} />
      <main>
        <div>
          <div className="card">
            <Canvas
              line={line} item={item} counts={counts} sel={sel} layout={layout} fitToken={fitToken}
              marks={changes?.marks} draggable={view !== 'proposal'}
              onSelect={selectNode} onLayoutChange={onLayoutChange}
            />
            <Legend canArrange={view !== 'proposal'} onTidy={tidy} onUndo={undoLayout ? undoTidy : null} />
          </div>
          <HistoryLog item={item} detailLoaded={detailLoaded} readonly={readonly} />
        </div>
        <Panel app={app} line={line} item={item} detailLoaded={detailLoaded} sel={sel} tab={tab} onTab={changeTab} />
      </main>
      {feedOpen && <FeedDialog line={liveLine} busy={busy} onSubmit={feed} onClose={closeFeed} />}
      {samplesOpen && <SamplesDialog app={app} line={liveLine} onClose={closeSamples} />}
      <div className={cx('toast', toast?.on && 'on', toast?.err && 'err')} role="status" onClick={() => setToast((t) => (t ? { ...t, on: false } : t))}>
        {toast?.msg}
      </div>
    </>
  );
}
