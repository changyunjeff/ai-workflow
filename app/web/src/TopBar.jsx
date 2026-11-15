import { useEffect, useState } from 'react';
import { api } from './api.js';
import {
  ITEM_ST, cx, fmtElapsed, fmtTime, groupTrialRuns, isApproved, itemGroup, itemLabel, itemStateName, parseStamp,
  passDetail, passRate, passTone, runTone, sortItems, titleOf, trialSummary, trialWentThrough,
} from './graph.js';

export const AI_BUSY_REASON = 'AI 上一次的改动还没处理完（见页面上方）。处理完才能再提新的意见。';

const lineFacts = (l) => [
  l.approved ? `已批准 · 第 ${l.version} 版` : `草稿 · 第 ${l.version} 版`,
  l.waiting > 0 && `${l.waiting} 件等你验收`,
  l.stopped > 0 && `${l.stopped} 件停线`,
  l.running > 0 && `${l.running} 件正在做`,
  l.proposal_ready && '有 AI 改动等你点头',
].filter(Boolean).join(' · ');

// The line name. With more than one line it opens a list to switch between them, and it
// says, without being opened, when another line has something waiting for the user.
function LinePicker({ line, lines, onSwitch }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !e.target.closest('.linepick')) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  if (!lines || lines.length < 2) return <h1>{line.name}</h1>;
  const others = lines.filter((l) => !l.current);
  const waiting = others.reduce((n, l) => n + (l.waiting || 0), 0);
  const elsewhere = [
    waiting > 0 && `有 ${waiting} 件等你验收`,
    others.some((l) => l.proposal_ready) && '有 AI 改动等你点头',
  ].filter(Boolean);
  const working = others.reduce((n, l) => n + (l.running || 0), 0);
  return (
    <>
      <span className="linepick">
        <button className="name" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{line.name} ▾</button>
        {open && (
          <div className="card linemenu">
            {lines.map((l) => (
              <button key={l.id} className={cx(l.current && 'cur')} onClick={() => { setOpen(false); onSwitch(l); }}>
                <div><b>{l.name}</b>{l.current && <span className="tag">正在看</span>}</div>
                <div className="sub">{lineFacts(l)}</div>
              </button>
            ))}
            <p className="hint" style={{ padding: '2px 9px' }}>点一条线就切过去看它。别的线上正在做的活不受影响，会照常做下去。</p>
          </div>
        )}
      </span>
      {elsewhere.length > 0 && (
        <button className="elsewhere" onClick={() => setOpen(true)}><i className="dot" />别的线上{elsewhere.join('，')}</button>
      )}
      {elsewhere.length === 0 && working > 0 && <span className="evid">别的线上有 {working} 件正在做</span>}
    </>
  );
}

export function Header({ app, line, lines, view, onAbout, onFeed, onViewTrial, onSwitchLine, onSamples }) {
  const approved = isApproved(line);
  const trial = line.trial;
  const running = !!trial?.running;
  const runs = trial?.items?.length || 0;
  const warnings = line.warnings || [];
  const samples = line.samples || [];
  const evidence = trialSummary(line);
  return (
    <header>
      <LinePicker line={line} lines={lines} onSwitch={onSwitchLine} />
      <span className="linestate">
        {approved ? (
          <>
            <span className="badge okd">你已批准 · 第 {line.version} 版</span>
            <span className="evid">
              {line.approved_at ? `批准于${fmtTime(line.approved_at, app.today)}。` : ''}
              <button
                className="link" disabled={app.busy}
                onClick={() => app.act(() => api.unapprove(), '已撤回批准，这条线回到草稿，不能投料。')}
              >撤回批准</button>
            </span>
          </>
        ) : (
          <>
            <span className="badge draft">草稿 · 第 {line.version} 版还没批准</span>
            <button className="btn ok" disabled={app.busy} onClick={app.approve}>批准这条线</button>
            <span className="evid">批准后才能投料、才能让活继续做；以后每改一版都要重新批准。</span>
          </>
        )}
        {warnings.length > 0 && <span className="warnline">留意：{warnings.join('；')}</span>}
        <span className="evid">
          <span className={cx('tone', evidence.tone)} title={evidence.detail.join('\n') || undefined}>{evidence.text}</span>
          {runs > 0 && view !== 'trial' && <>。<button className="link" onClick={onViewTrial}>看试跑的 {runs} 次</button></>}
        </span>
        {line.samples && (
          <>
            <button className="link" onClick={onSamples}>样例 {samples.length} 份</button>
            {samples.length === 1 && <span className="warnline">只有 1 份样例</span>}
          </>
        )}
        <button
          className="btn small" disabled={app.busy || running}
          onClick={() => app.act(() => api.trial(), '开始试跑了：每一份样例都会跑几遍，结果会显示在这里。')}
        >试跑</button>
        <span className="evid">{running ? '（等这一轮跑完才能再试跑）' : '（把每份样例各跑几遍，不影响正式的活）'}</span>
      </span>
      <span className="spacer" />
      <button className="btn" onClick={onAbout}>这条线的说明</button>
      <button className={cx('btn primary', !approved && 'faded')} onClick={onFeed}>投新料</button>
      {!approved && <span className="evid">（草稿不能投料）</span>}
    </header>
  );
}

function ItemChip({ item, cur, onPick }) {
  return (
    <button
      className={cx('chip', ITEM_ST[item.state]?.[1], item.id === cur && 'cur')}
      title={[item.title, item.created && `投料时间：${item.created}`].filter(Boolean).join(' · ') || undefined}
      onClick={() => onPick(item.id)}
    >{itemLabel(item)} · {itemStateName(item)}</button>
  );
}

// The runs of a trial, grouped by sample, the worrying ones first. Read-only items.
function TrialPicker({ items, cur, onPick, running }) {
  const groups = groupTrialRuns(items);
  // inside a group the sample name is already said once: "样例「短会」第 2 次" -> "第 2 次"
  const short = (it) => (it.sample && String(it.name).startsWith(`样例「${it.sample}」`) ? String(it.name).slice(`样例「${it.sample}」`.length) : it.name);
  return (
    <div className="card itemlist">
      <div className="row">
        <span>看哪一次试跑（共 {items.length} 次{running ? '，还在跑' : ''}）</span>
        <span className="hint">没走通的排在最前。走通了 = 走到了等你验收或出货；"中途被退回"说明是险过。</span>
      </div>
      {items.length === 0 && <p className="hint">{running ? '正在试跑，跑完一次这里就多一次。' : '这次试跑没有留下记录。'}</p>}
      {groups.map((g) => (
        <div className="trialgroup" key={g.sample}>
          {g.sample && <span className="sub">样例「{g.sample}」</span>}
          {g.runs.map((it) => (
            <button
              key={it.id} className={cx('chip', runTone(it), it.id === cur && 'cur')}
              title={it.why || undefined} onClick={() => onPick(it.id)}
            >{short(it)} · {it.state_name || (trialWentThrough(it) ? '走通了' : '没走通')}</button>
          ))}
        </div>
      ))}
    </div>
  );
}

const FILTERS = [['all', '全部'], ['wait', '等你验收'], ['stop', '停线'], ['run', '正在做'], ['other', '其他']];

// Up to 8 items: clickable chips like the mockup. More: a filterable list, waiting items first.
export function ItemPicker({ view, items, cur, onPick, running }) {
  const [filter, setFilter] = useState('all');
  if (view !== 'live') return <TrialPicker items={items} cur={cur} onPick={onPick} running={running} />;
  if (!items.length) {
    return <div className="strip"><span>看哪件活：</span><span className="hint">还没有投过料。批准这条线之后，点右上角的"投新料"。</span></div>;
  }
  const sorted = sortItems(items);
  const waiting = sorted.filter((it) => it.state === 'waiting');
  const others = waiting.filter((it) => it.id !== cur);
  const next = others.length ? waiting[(waiting.findIndex((it) => it.id === cur) + 1) % waiting.length] : null;
  const nextButton = next && (
    <button className="btn small primary" onClick={() => onPick(next.id)}>下一件待验收（还有 {others.length} 件）</button>
  );
  if (items.length <= 8) {
    return (
      <div className="strip">
        <span>看哪件活：</span>
        {items.map((it) => <ItemChip key={it.id} item={it} cur={cur} onPick={onPick} />)}
        <span className="hint">（共 {items.length} 件）</span>
        {nextButton}
      </div>
    );
  }
  const count = (key) => (key === 'all' ? items.length : items.filter((it) => itemGroup(it) === key).length);
  const shown = filter === 'all' ? sorted : sorted.filter((it) => itemGroup(it) === filter);
  return (
    <div className="card itemlist">
      <div className="row">
        <span>看哪件活（共 {items.length} 件）：</span>
        {FILTERS.map(([key, name]) => (
          <button key={key} className={cx('filter', filter === key && 'on')} onClick={() => setFilter(key)}>{name} {count(key)}</button>
        ))}
        <span className="spacer" />
        {nextButton || <span className="hint">{waiting.length ? '只有眼前这一件在等你验收。' : '现在没有活在等你验收。'}</span>}
      </div>
      <div className="itemscroll">
        {shown.length
          ? shown.map((it) => <ItemChip key={it.id} item={it} cur={cur} onPick={onPick} />)
          : <span className="hint">这一类现在没有活。</span>}
      </div>
    </div>
  );
}

// The always-visible bar that says "you are not looking at the real items" and how to get back.
export function ModeBar({ view, line, removed, onExit }) {
  if (view === 'trial') {
    const t = line.trial;
    return (
      <div className="modebar trial">
        <span>
          <b>你正在看第 {line.version} 版的试跑</b>
          {t ? `（${t.running ? '还在跑' : passRate(t)}）` : ''}。这些是试跑的活，只能看，不能验收或重做。
        </span>
        <button className="btn" onClick={onExit}>回到正式的活</button>
      </div>
    );
  }
  return (
    <div className="modebar proposal">
      <span>
        <b>你正在看 AI 改后的样子，还没生效。</b>
        图上标着"AI 新加""AI 改过"的节点是它动过的{removed.length ? `；它去掉了${removed.map((n) => `「${n.title}」`).join('、')}` : ''}。
        下面的活是 AI 用样例试跑的，只能看。要不要采用，在下面那一栏里点。
      </span>
      <button className="btn" onClick={onExit}>回到现在的线</button>
    </div>
  );
}

export function AskBox({ app }) {
  const [text, setText] = useState('');
  const blocked = !!app.proposal;
  const submit = async () => {
    if (!text.trim()) { app.toast('请先写一句意见，不然 AI 不知道往哪改。'); return; }
    const res = await app.act(() => api.ai('line', text.trim()), 'AI 开始改了。改完会在这里给你看改了什么和试跑结果，你点头才生效。');
    if (res) setText('');
  };
  return (
    <div className="card ask">
      <span>对整条线有意见？</span>
      <input
        type="text" value={text} placeholder="直接说，比如：在写摘要前面加一站，先核对事实"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !blocked && !app.busy) submit(); }}
      />
      <button className="btn primary" disabled={blocked || app.busy} onClick={submit}>交给 AI</button>
      <p className="hint">
        {blocked ? AI_BUSY_REASON : '交给 AI 之后：它先改，再用样例试跑，然后把改了什么和试跑结果给你看。你点"采用"新版才生效；点"不要"什么都不变。'}
      </p>
    </div>
  );
}

// "已经等了 2 分 10 秒", ticking on its own so the rest of the page does not re-render.
function Waited({ since }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const start = parseStamp(since);
  if (!start || Number.isNaN(start.getTime())) return null;
  return <>已经等了 {fmtElapsed(Date.now() - start.getTime())}。</>;
}

// Shown under the top area whenever line.proposal has a value.
export function ProposalBanner({ app, line, view, onPreview }) {
  const p = line.proposal;
  if (!p) return null;
  const target = p.scope && p.scope !== 'line' ? `「${titleOf(line, p.scope)}」` : '整条线';
  const said = (
    <>
      <dt>你的意见</dt><dd>{p.text || '（没有记下来）'}</dd>
      <dt>针对</dt><dd>{target}</dd>
    </>
  );
  if (p.state === 'working') {
    const cancel = () => {
      if (!window.confirm('取消之后，AI 这次改到一半的东西就不要了，想要得重新提意见。要取消吗？')) return;
      app.act(() => api.aiReject(), '已取消这次改动，这条线什么都没变。');
    };
    return (
      <div className="proposal working">
        <h2>AI 正在改，改完会用样例试跑……</h2>
        <dl>{said}</dl>
        <p><Waited since={p.requested_at} />通常要 1 到 4 分钟。</p>
        <div className="row"><button className="btn" disabled={app.busy} onClick={cancel}>不等了，取消这次改动</button></div>
        <p className="hint">改完会在这里给你看改了什么和试跑结果。你点头之前，现在的版本不会变。这期间你自己不能保存改动，也不能换版本，免得两边互相冲掉。取消：这次改动作废，线不变，点了会先问你一遍。</p>
      </div>
    );
  }
  if (p.state === 'failed') {
    return (
      <div className="proposal failed">
        <h2>AI 这次没改成</h2>
        <dl>{said}<dt>原因</dt><dd>{p.error || '没有说明原因。'}</dd></dl>
        <div className="row"><button className="btn" disabled={app.busy} onClick={() => app.act(() => api.aiReject())}>关掉</button></div>
        <p className="hint">现在的版本没有变。关掉之后可以重新提意见。</p>
      </div>
    );
  }
  const summary = p.summary || [];
  const t = p.trial;
  const detail = t ? passDetail(t) : [];
  const stale = p.base_version != null && p.base_version !== line.version;
  const reject = () => {
    if (!window.confirm('不要之后这次改动就丢了，想要得重新提意见。\n确定不要吗？')) return;
    app.act(() => api.aiReject(), '没有采用，这条线什么都没变。');
  };
  return (
    <div className="proposal ready">
      <h2>AI 改好了，等你点头</h2>
      <dl>
        {said}
        <dt>改了什么</dt>
        <dd>{summary.length ? <ul>{summary.map((s, i) => <li key={i}>{s}</li>)}</ul> : '（AI 没有列出改了什么）'}</dd>
        <dt>试跑结果</dt>
        <dd>
          {!t ? '没有试跑结果' : t.error ? <span className="tone bad">试跑没跑成：{t.error}</span> : (
            <>
              <span className={cx('tone', passTone(t))}>AI 改完后试跑：{passRate(t)}</span>
              {detail.length > 1 && <ul>{detail.map((d) => <li key={d}>{d}</li>)}</ul>}
            </>
          )}
        </dd>
      </dl>
      {stale && <p className="amber">注意：AI 是照第 {p.base_version} 版改的，这条线现在已经是第 {line.version} 版，采用会被拒绝。请点"不要"，再把意见重新提一次。</p>}
      <div className="row">
        {p.line && view !== 'proposal' && <button className="btn" onClick={onPreview}>看改后的样子和试跑</button>}
        <button className="btn ok" disabled={app.busy} onClick={app.acceptAi}>采用</button>
        <button className="btn bad" disabled={app.busy} onClick={reject}>不要</button>
      </div>
      <p className="hint">
        看改后的样子：在图上看 AI 改完的线，和它试跑的每一次，不会生效。
        采用：新版替换现在的版本。如果这条线现在是已批准的，采用后仍算已批准；如果现在是草稿，采用后还是草稿。
        不要：这次改动丢掉，线不变，点了会先问你一遍。
      </p>
    </div>
  );
}
