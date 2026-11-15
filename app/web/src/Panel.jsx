import { useEffect, useState } from 'react';
import { api } from './api.js';
import Clamp from './Clamp.jsx';
import { AI_BUSY_REASON } from './TopBar.jsx';
import {
  STOP_ID, cx, fileLabel, flowSentence, fmtDuration, fmtTime, gatesAfter, gatesBefore, isAiGate, isApproved, isAutoGate, isMachineGate,
  judgeName, kindName, lastRejectReason, nextInFlow, nodeById, nodeState, stateText, titleOf, trialText,
} from './graph.js';

const AI_PENDING = 'AI 的改动还没处理完，先采用或不要它。';

// ---------- shared pieces ----------

// Tell the app that this piece holds unsaved input, so leaving can be confirmed first.
function useDirty(app, key, dirty) {
  const flags = app.dirty;
  useEffect(() => {
    flags.current[key] = dirty;
    return () => { delete flags.current[key]; };
  }, [flags, key, dirty]);
}

// A form draft that polling cannot overwrite: server values are adopted only while the draft is untouched.
function useDraft(app, key, server) {
  const serverSig = JSON.stringify(server);
  const [draft, setDraft] = useState(server);
  const [base, setBase] = useState(serverSig);
  const [saving, setSaving] = useState(false);
  const draftSig = JSON.stringify(draft);
  const dirty = draftSig !== base;
  if (serverSig !== base && !dirty && !saving) { setBase(serverSig); setDraft(server); }
  useDirty(app, key, dirty);
  return {
    draft,
    dirty,
    // someone else changed this node while the user was typing
    stale: dirty && !saving && serverSig !== base,
    set: (patch) => setDraft((d) => ({ ...d, ...patch })),
    commit: async (send) => {
      setSaving(true);
      const res = await send();
      if (res) setBase(draftSig);
      setSaving(false);
      return res;
    },
  };
}

function Items({ list }) {
  return list && list.length ? <ul>{list.map((x, i) => <li key={i}><Clamp text={x} /></li>)}</ul> : <span className="hint">还没有</span>;
}

const DRAFT = '这条线现在是草稿，批准之后才能让它继续干活。';

// "把这件活的原料加进样例": a real item becomes one more case every trial run is checked against.
function ToSample({ app, item, lead }) {
  if (app.readonly) return null;
  return (
    <>
      <div className="row">
        <button className="btn" disabled={app.busy} onClick={() => app.act(() => api.itemToSample(item.id), '已加进样例，下次试跑会把它也跑一遍。')}>把这件活的原料加进样例</button>
      </div>
      <p className="hint">{lead || '加进样例之后，以后每次试跑都会拿这份原料再跑一遍。不影响这件活本身。'}</p>
    </>
  );
}

// One attempt of a station: a short heading, the (possibly long) reason folded, the text on demand.
function Attempt({ t, index, open }) {
  const n = t.n ?? index + 1;
  const verdict = String(t.verdict || '');
  const cut = verdict.indexOf('：');
  const head = cut > 0 ? verdict.slice(0, cut) : verdict;
  const reason = cut > 0 ? verdict.slice(cut + 1) : '';
  return (
    <div className="attempt">
      <details open={open}>
        <summary>
          第 {n} 次{t.round != null && t.round !== n ? `（这一轮的第 ${t.round} 次）` : ''}{t.chars != null ? ` · ${t.chars} 字` : ''}{head ? ` · ${head}` : ''}
        </summary>
        {t.text != null ? <div className="box">{t.text}</div> : <p className="hint">这一次的原文没有读到。</p>}
      </details>
      {reason && <p className="reason"><Clamp text={reason} /></p>}
    </div>
  );
}

// "打开文件 …" only exists for real items; trial runs live elsewhere and are view-only.
function OpenLink({ app, item, file }) {
  if (app.readonly) return null;
  return (
    <p>
      <button className="link" disabled={app.busy} onClick={() => app.act(() => api.open(item.id, file), '已在电脑上打开。')}>打开文件 {file}</button>
      {' '}
      <span className="hint">
        它在这件活的文件夹里{item.folder ? `（${item.folder}）` : ''}。
        <button className="link" disabled={app.busy} onClick={() => app.act(() => api.open(item.id), '已在电脑上打开。')}>打开文件夹</button>
      </span>
    </p>
  );
}

function VersionLine({ app, line }) {
  const changed = [fmtTime(line.changed_at, app.today), line.changed_by].filter(Boolean).join('，');
  return (
    <p className="hint">
      这条线现在是第 {line.version} 版 · {changed ? `上次改动：${changed}` : '没改过'} · {isApproved(line) ? '你已批准' : '草稿，你还没批准'} · {trialText(line)}
    </p>
  );
}

function AiBox({ app, scope, what }) {
  const [text, setText] = useState('');
  useDirty(app, `ai:${scope}`, text.trim() !== '');
  const blocked = !!app.proposal;
  const submit = async () => {
    if (!text.trim()) { app.toast('请先写一句意见，不然 AI 不知道往哪改。'); return; }
    const res = await app.act(() => api.ai(scope, text.trim()), 'AI 开始改了。改完会在页面上方给你看改了什么和试跑结果，你点头才生效。');
    if (res) setText('');
  };
  return (
    <section>
      <h3>让 AI 改</h3>
      <textarea value={text} placeholder="用一句话说哪里不对。比如：摘要太书面，写得口语一点" onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button className="btn primary" disabled={blocked || app.busy} onClick={submit}>交给 AI 改</button>
      </div>
      <p className="hint">
        {blocked ? AI_BUSY_REASON : `AI 会带着你的意见改${what}，改完用你给的样例试跑，把改了什么和试跑结果给你看。你点头，新版才替换现在的版本；你不点头，什么都不变。`}
      </p>
    </section>
  );
}

function SaveRow({ app, form, onSave, extra }) {
  const why = app.aiPending ? AI_PENDING : !form.dirty ? '还没有改动，所以不能保存。' : '';
  const off = !!why || app.busy;
  return (
    <>
      {form.stale && (
        <div className="box warn">注意：这里的规矩刚刚被改过（可能是采用了 AI 的改动，或者换回了别的版本）。你现在保存，会用你框里的内容盖掉新的。</div>
      )}
      <div className="row">
        <button className="btn" disabled={off} onClick={() => onSave(false)}>保存</button>
        <button className="btn" disabled={off} onClick={() => onSave(true)}>保存并试跑</button>
      </div>
      {why && <p className="hint amber">{why}</p>}
      <p className="hint">
        保存：存成新的一版。新版是草稿，要你重新批准才能投料；旧版都留着，可以在"这条线的说明"里换回。
        保存并试跑：存完马上用样例跑 3 遍，告诉你新版走不走得通。
        已经在做的活：还没走到这一步的按新版做，已经过了这一步的不受影响。
      </p>
      {extra && <p className="hint">{extra}</p>}
    </>
  );
}

const savedMsg = (trial) => (res) => `已存成第 ${res.version ?? '新的一'} 版，现在是草稿，批准后才能投料。${trial ? '已开始用样例试跑，结果看页面上方。' : ''}`;

function saveNode(app, form, node, patch) {
  return (trial) => form.commit(() => app.act(() => api.saveNode(node.id, patch(), trial), savedMsg(trial)));
}

// ---------- "这条线的说明" ----------

function VersionList({ app, line }) {
  const rows = line.history || [];
  const switchTo = (h) => {
    if (!app.leaveOk()) return;
    const ask = `要换回第 ${h.version} 版的内容吗？\n（那一版：${h.note || '没有说明'}）\n\n会存成新的第 ${line.version + 1} 版，是草稿，批准后才能投料。现在这一版还留在清单里，随时能再换回来。`;
    if (!window.confirm(ask)) return;
    app.act(() => api.revert(h.version), (res) => `已换回第 ${h.version} 版的内容，存成了第 ${res.version ?? line.version + 1} 版。现在是草稿，批准后才能投料。`);
  };
  return (
    <section>
      <h3>版本</h3>
      <VersionLine app={app} line={line} />
      {rows.length === 0 ? <p className="hint">没有读到版本清单。</p> : (
        <ul className="versions">
          {rows.map((h) => (
            <li key={h.version} className={cx(h.current && 'cur')}>
              <div>
                <b>第 {h.version} 版</b>{h.current && <span className="tag">现在用的</span>}
                <span className="hint"> · {h.by || '没记下是谁'} · {fmtTime(h.at, app.today) || '没记下时间'}</span>
              </div>
              <div className="note">{h.note || '没有说明'}</div>
              {!h.current && (
                <button className="btn small" disabled={app.aiPending || app.busy} onClick={() => switchTo(h)}>换回这一版</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {app.aiPending && <p className="hint amber">{AI_PENDING}</p>}
      <p className="hint">换回这一版：把那一版的内容拿回来，存成新的一版（草稿，批准后才能投料）。点了会先问你一遍；别的版本都还在，不会丢。</p>
    </section>
  );
}

function LineAbout({ app, line }) {
  return (
    <>
      <h2>这条线的说明</h2>
      {app.view === 'proposal' && <p className="scope ro">这是 AI 改后的说明，还没生效。</p>}
      <section>
        <dl>
          <dt>原料</dt><dd>{line.input}</dd>
          <dt>成品</dt><dd>{line.output}</dd>
          <dt>怎么走</dt><dd>{flowSentence(line)}</dd>
          <dt>什么时候拆</dt><dd>{line.retire || '还没写'}</dd>
        </dl>
      </section>
      {app.view !== 'proposal' && <VersionList app={app} line={line} />}
      <section>
        <h3>几个词</h3>
        <dl>
          <dt>站</dt><dd>干一步活。每站由一个 AI 工人照着"规格"干。</dd>
          <dt>规格</dt><dd>写给工人看的说明：这一步要做什么、做成什么样。</dd>
          <dt>门</dt><dd>检查上一步的产出。机器判的门由程序自动查；AI 判的门由另一个 AI 读懂内容来查；你来判的门等你点头。</dd>
          <dt>退回</dt><dd>门判不合格，把活送回前面的站重做，并告诉它哪里不对。</dd>
          <dt>停线</dt><dd>重做到上限还不合格，这件活停下等你处理。不合格的东西不会流到后面。</dd>
          <dt>试跑</dt><dd>用你给的样例原料把线跑几遍，看走不走得通。试跑的活不算正式的活。</dd>
          <dt>换回</dt><dd>把这条线的规矩换成以前某一版的内容。和"退回"不是一回事。</dd>
        </dl>
      </section>
    </>
  );
}

// ---------- "这件活" tab ----------

const GONE = '这件活已放弃，不再处理。';
const SHIPPED = '这件活已出货。想重做请重新投料，免得盖掉成品。';

function FileItem({ app, node, item }) {
  const isSource = node.kind === 'source';
  const has = isSource || item.state === 'done';
  const text = item.files?.[node.file];
  return (
    <section>
      <h3>{isSource ? '投进来的原料' : '交出来的成品'}</h3>
      {has ? (
        <>
          <OpenLink app={app} item={item} file={node.file} />
          {text != null ? <div className="box">{text}</div> : <p className="hint">没读到文件 {node.file} 的内容。</p>}
          {isSource && <ToSample app={app} item={item} />}
        </>
      ) : <p className="hint">{app.readonly ? '试跑走到等你验收就算走通，不会真的出货，所以这里没有成品。' : '这件活还没出货，这里还没有成品。'}</p>}
      {!isSource && has && !app.readonly && <p className="hint">出货的意思：你验收过了，这份文件就是最终成品，放在上面那个文件夹里。它不会被自动发到别处。</p>}
    </section>
  );
}

function StationItem({ app, node, item, state }) {
  const tries = item.tries?.[node.id] || [];
  const running = state === 'run';
  const seconds = item.nodes?.[node.id]?.seconds;
  const fallback = !tries.length && !running ? item.files?.[node.output] : null;
  const why = item.state === 'abandoned' ? GONE
    : item.state === 'done' ? SHIPPED
    : app.draft ? DRAFT
    : running ? '这一步正在做，等它做完。'
    : item.state === 'running' ? '这件活正在别的步骤上做，等它停下来再重做。'
    : state === 'idle' ? '这件活还没走到这一步。' : '';
  const run = (only) => app.act(
    () => api.run(item.id, node.id, only),
    only ? '开始只重做这一步，做完就停下。旧的产出留着，记为上一次。' : '开始重做这一步，做完会接着往后走。旧的产出留着，记为上一次。',
  );
  return (
    <>
      <section>
        <h3>这件活在这一步的产出</h3>
        {running && (
          <div className="box">
            正在做{Number.isFinite(seconds) ? `，已经 ${seconds} 秒` : ''}。{node.timeout ? `超过 ${fmtDuration(node.timeout)}会判为卡住并停线。` : ''}
          </div>
        )}
        {tries.map((t, k) => <Attempt key={t.n ?? k} t={t} index={k} open={k === tries.length - 1} />)}
        {fallback != null && <div className="box">{fallback}</div>}
        {tries.length || fallback != null
          ? <OpenLink app={app} item={item} file={node.output} />
          : (!running && <p className="hint">还没有产出。</p>)}
      </section>
      {!app.readonly && (
        <section>
          <h3>重跑</h3>
          <div className="row">
            <button className="btn" disabled={!!why || app.busy} onClick={() => run(true)}>只重做这一步</button>
            <button className="btn" disabled={!!why || app.busy} onClick={() => run(false)}>重做这一步并接着往后走</button>
          </div>
          {why && <p className="hint amber">{why}</p>}
          <p className="hint">
            只重做这一步：重做一遍就停下，等你看过再决定。重做并接着往后走：重做后照常过门，直到出货、等你验收或停线。
            两个按钮都不会删掉旧的产出，旧的记为上一次；重写次数从头算。
          </p>
        </section>
      )}
    </>
  );
}

// Machine gates and AI gates: both judge by themselves and keep a record of every verdict.
function AutoGateItem({ app, node, item, state }) {
  const judged = item.judged?.[node.id];
  const has = !!judged?.length;
  const judging = state === 'run';
  const seconds = item.nodes?.[node.id]?.seconds;
  const why = item.state === 'abandoned' ? GONE
    : item.state === 'done' ? SHIPPED
    : app.draft ? DRAFT
    : judging ? '这道门正在判，等它判完。'
    : item.state === 'running' ? '这件活正在做，等它停下来再重新判。'
    : !has ? '这件活还没走到这道门。' : '';
  return (
    <>
      <section>
        <h3>这件活的判定记录</h3>
        {judging && (
          <div className="box">{isAiGate(node) ? 'AI 质检员正在看' : '正在判'}{Number.isFinite(seconds) ? `，已经 ${seconds} 秒` : ''}。</div>
        )}
        {has || !judging ? <Items list={judged} /> : null}
      </section>
      {!app.readonly && (
        <section>
          <h3>重跑</h3>
          <div className="row">
            <button
              className="btn" disabled={!!why || app.busy}
              onClick={() => app.act(() => api.run(item.id, node.id, false), '开始按现在的标准重新判。')}
            >重新判一次</button>
          </div>
          {why && <p className="hint amber">{why}</p>}
          <p className="hint">重新判一次：按现在的标准，把这件活最新的产出再检查一遍。合格就接着往后走；不合格照常退回重写。改过标准之后想马上看结果，可以点这个。</p>
        </section>
      )}
    </>
  );
}

function HumanGateItem({ app, line, node, item, state }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  useDirty(app, `reason:${item.id}:${node.id}`, reason.trim() !== '');
  const judged = item.judged?.[node.id];

  if (state !== 'wait') {
    return (
      <section>
        <h3>这件活的判定记录</h3>
        {judged?.length ? <Items list={judged} /> : <p className="hint">{item.state === 'abandoned' ? GONE : app.readonly ? '这次试跑没有走到这道门。' : '这件活现在不在等验收。'}</p>}
      </section>
    );
  }

  // only the gates that really checked this very file may be credited here
  const passed = gatesBefore(line, node).filter((n) => item.nodes?.[n.id]?.state === 'pass');
  const output = item.files?.[node.file];
  const refs = Object.keys(item.files || {}).filter((name) => name !== node.file).reverse();
  const backTitle = titleOf(line, node.on_fail);
  const ships = nextInFlow(line, node.id)?.kind === 'product';
  const lastReason = lastRejectReason(judged);

  const approve = async () => {
    const res = await app.act(() => api.decide(item.id, node.id, true));
    if (res) app.afterDecide(item, ships ? `${item.name}已出货。` : `${item.name}已判合格，接着往后走。`);
  };
  const reject = async () => {
    if (!reason.trim()) { app.toast('请先写一句理由，不然它不知道该怎么改。'); return; }
    const res = await app.act(() => api.decide(item.id, node.id, false, reason.trim()));
    if (res) {
      setReason(''); setOpen(false);
      app.afterDecide(item, `${item.name}已带着你的理由退回「${backTitle}」重写，写完会再回来等你。`);
    }
  };

  return (
    <section>
      <h3>{app.readonly ? '试跑走到了这里' : '等你验收'}</h3>
      <p className="hint">
        {app.readonly ? '正式的活走到这一步会停下等你验收；试跑走到这里就算走通。下面是这次试跑交到这里的产出。' : ''}
        {passed.length ? `这份产出已通过前面的门：${passed.map((g) => `「${g.title}」（${judgeName(g)}）`).join('、')}。` : ''}
        {node.points ? `验收要点：${node.points}` : '这道门还没写验收要点。'}
      </p>
      {lastReason && !app.readonly && (
        <div className="box">上一次你把它退回了，理由是：{lastReason}。下面是按这个理由重写后的。</div>
      )}
      {output != null ? <div className="box warn">{output}</div> : <p className="hint">没读到待验收的产出（文件 {node.file}）。</p>}
      {refs.length > 0 && (
        <details>
          <summary>对照前面的材料（查有没有编造）</summary>
          {refs.map((name) => (
            <div key={name}>
              <p className="hint">{fileLabel(line, name)}：</p>
              <div className="box">{item.files[name]}</div>
            </div>
          ))}
        </details>
      )}
      {!app.readonly && (
        <>
          <div className="row">
            <button className="btn ok" disabled={app.busy || (app.draft && !ships)} onClick={approve}>{ships ? '合格，出货' : '合格，接着往后走'}</button>
            <button className="btn bad" disabled={app.busy || app.draft} onClick={() => setOpen(true)}>不合格……</button>
          </div>
          {app.draft && <p className="hint amber">{DRAFT}{ships ? '"合格，出货"不用再干活，所以现在也能点。' : ''}</p>}
          <p className="hint">
            {ships ? '合格，出货：这件活记为已出货，成品就是上面这份产出。点了就生效，不能撤回。' : '合格：这件活照常往后走。点了就生效，不能撤回。'}
            不合格：先让你写一句理由，再带着理由退回「{backTitle}」重写，写完重新过门，回到这里等你。
          </p>
          {open && (
            <div>
              <textarea autoFocus value={reason} placeholder={`写一句理由（必填）。它会带着这句话退回「${backTitle}」重写`} onChange={(e) => setReason(e.target.value)} />
              <div className="row">
                <button className="btn bad" disabled={app.busy} onClick={reject}>确认退回重写</button>
              </div>
              <p className="hint">这句理由只用在这一件活上。如果你希望以后每件都这样写，请到「{backTitle}」的"这一站的规矩"里改，或者在页面上方对整条线提意见。</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StopItem({ app, line, item, state }) {
  if (state !== 'stopped') {
    return <section><h3>停线</h3><p className="hint">{item.state === 'abandoned' ? GONE : app.readonly ? '这次试跑没有停线。' : '这件活没有停线。'}</p></section>;
  }
  if (app.readonly) {
    return (
      <section>
        <h3>这次试跑为什么停</h3>
        <div className="box warn">{item.why || '没有记下停线的原因。'}</div>
        <p className="hint">这是试跑，不用处理。想让它走通，回到正式的线去改规矩（或让 AI 改），再试跑一次。</p>
      </section>
    );
  }
  if (item.state === 'abandoned') {
    // the engine keeps the stop marks on an item that was abandoned while stopped
    return (
      <section>
        <h3>这件活停线后被放弃了</h3>
        <div className="box warn">{item.why || '服务没有记下停线的原因。'}</div>
        <p className="hint">{GONE}原料和已有的产出文件都还在。想再做一遍，请重新投料。</p>
      </section>
    );
  }
  const from = item.resume_from;
  const fromNode = from ? nodeById(line, from) : null;
  const fromTitle = fromNode?.title || from || '';
  // the gate that sent the item to the stop node: the walked edge that ends in ">stop"
  const gateId = (item.walked || []).map((w) => w.split('>')).find((p) => p[1] === STOP_ID)?.[0];
  const gate = gateId ? nodeById(line, gateId) : null;
  const abandon = () => {
    if (!window.confirm(`确定放弃${item.name}吗？\n放弃后这件活不再处理。原料和已有的产出文件都保留，不会删。`)) return;
    app.act(() => api.abandon(item.id), `${item.name}已放弃。文件都还在。`);
  };
  return (
    <section>
      <h3>这件活为什么停</h3>
      <div className="box warn"><Clamp text={item.why || '服务没有记下停线的原因。'} limit={160} /></div>
      <ToSample app={app} item={item} lead="把它加进样例，以后每次试跑都会检查这种情况。" />
      {fromNode?.kind === 'station' && (
        <p className="hint">
          可能是「{fromTitle}」的规格没写清楚{gate ? `，也可能是「${gate.title}」这道门的标准定得不合适。先去改好其中一处，并重新批准这条线，再回来点下面的按钮。` : '。先去改好，并重新批准这条线，再回来点下面的按钮。'}
        </p>
      )}
      <div className="row">
        <button
          className="btn" disabled={!from || app.busy || app.draft}
          onClick={() => app.act(() => api.run(item.id, from, false), `开始从「${fromTitle}」重新做起，按现在最新的规矩做。`)}
        >{!from ? '重新做起' : fromNode?.kind === 'gate' ? `从「${fromTitle}」重新判起` : `从「${fromTitle}」重新做起`}</button>
      </div>
      {app.draft && <p className="hint amber">{DRAFT}</p>}
      <p className="hint">
        {from
          ? (fromNode?.kind === 'gate'
            ? '这道门会按现在最新的标准重新判一遍，然后照常往后走。之前的产出都留着。'
            : '这一站会重写一遍，重写次数从头算，然后照常往后走。按现在最新的规矩做；之前的产出都留着。')
          : '服务没有说该从哪一站重新做起。可以点图上的某一站，用它的"重做这一步并接着往后走"。'}
      </p>
      <div className="danger">
        <button className="btn bad" disabled={app.busy} onClick={abandon}>放弃这件活</button>
        <p className="hint">放弃：这件活不再处理。点了会先问你一遍。原料和已有的产出文件都保留，不删除。</p>
      </div>
    </section>
  );
}

// An item left "idle" after "只重做这一步": say so, and offer to carry on from the next node.
function IdleNote({ app, line, item }) {
  const at = nodeById(line, item.at);
  if (item.state !== 'idle' || at?.kind !== 'station' || item.nodes?.[at.id]?.state !== 'done') return null;
  const next = nextInFlow(line, at.id);
  const canGo = next && next.kind !== 'product';
  return (
    <div className="box warn">
      这件活停着：只重做了「{at.title}」这一步，还没往后走。
      {canGo && (
        <>
          <div className="row">
            <button className="btn" disabled={app.busy || app.draft} onClick={() => app.act(() => api.run(item.id, next.id, false), `开始从「${next.title}」接着往后走。`)}>接着往后走</button>
          </div>
          {app.draft && <span className="hint amber">{DRAFT}<br /></span>}
          <span className="hint">接着往后走：从「{next.title}」开始照常走，直到出货、等你验收或停线。「{at.title}」刚重做的产出不会再重写。</span>
        </>
      )}
    </div>
  );
}

function ItemTab({ app, line, node, item, state, detailLoaded }) {
  if (!item) {
    if (app.readonly) return <section><p className="hint">上面选一次试跑，这里就显示它在这一步的情况。</p></section>;
    return <section><h3>还没有投过料</h3><p className="hint">这条线上还没有活。批准这条线之后，点右上角的"投新料"，这里就会显示那件活在这一步的情况。</p></section>;
  }
  if (!detailLoaded) return <section><p className="hint">正在读取{item.name}……</p></section>;
  const body = node.id === STOP_ID ? <StopItem app={app} line={line} item={item} state={state} />
    : node.kind === 'source' || node.kind === 'product' ? <FileItem app={app} node={node} item={item} />
    : node.kind === 'station' ? <StationItem app={app} node={node} item={item} state={state} />
    : isAutoGate(node) ? <AutoGateItem app={app} node={node} item={item} state={state} />
    : <HumanGateItem app={app} line={line} node={node} item={item} state={state} />;
  return (
    <>
      {!app.readonly && <IdleNote app={app} line={line} item={item} />}
      {body}
    </>
  );
}

// ---------- "这一站的规矩" tab ----------

function StationFacts({ line, node }) {
  const gates = gatesAfter(line, node);
  return (
    <section>
      <h3>这一步的其他规矩</h3>
      <dl>
        <dt>谁干</dt><dd>AI 工人{line.worker_name ? `（${line.worker_name}）` : ''}。{node.model ? '这一站用更强的模型。' : ''}以后可以换成别家的 AI。</dd>
        <dt>收什么</dt><dd>{node.input ? `文件 ${node.input}` : '没写'}</dd>
        {node.refs?.length ? <><dt>还参考</dt><dd>{node.refs.map((f) => `文件 ${f}`).join('、')}</dd></> : null}
        <dt>交什么</dt><dd>{node.output ? `文件 ${node.output}` : '没写'}</dd>
        <dt>后面的门</dt>
        <dd>
          {gates.length === 0
            ? <span className="amber">还没有门。按你的标准每站都该有一道，可以让 AI 补。</span>
            : `${gates.map((g) => `「${g.title}」（${judgeName(g)}）`).join('、')}。${gates.some(isAutoGate) ? '门上的要求（比如字数、合格标准）只写在门上，这里不用重复写。' : ''}`}
        </dd>
        {node.timeout ? <><dt>多久算卡住</dt><dd>超过 {fmtDuration(node.timeout)}还没做完，就判为卡住并停线。</dd></> : null}
      </dl>
    </section>
  );
}

const ROUND_NOTE = '每一轮单独计数：你验收退回、或你手动重做之后，重新从 1 数。';
const AI_JUDGE = 'AI 质检员（另一个 AI 读懂内容后按下面的标准判，会花一点额度）';
// what the AI inspector compares the output against
// (reference is one file name or a list of them)
const referenceOf = (node) => {
  const refs = [].concat(node.reference || []).filter(Boolean);
  return refs.length ? refs.map((f) => `文件 ${f}`).join('、') : '上一站的输入';
};
// a machine check the page shows but does not edit
const backtickRule = (file) => `文件 ${file} 里用反引号（键盘左上角的 \` 符号，技术文档里用它括住命令和配置项）括起来的内容，必须原样保留`;
// the line's own description of its product is free text and does not follow the gates
const productNote = (line) => `这条线的说明里写的成品（「${line.output}」）不会自动跟着变，改了标准记得让 AI 一起改说明。`;

function MachineFail({ line, node, readonly }) {
  return (
    <section>
      <h3>不合格怎么办</h3>
      <p>退回「{titleOf(line, node.on_fail)}」，并告诉它哪里不合格、该怎么改。</p>
      {!readonly && <p className="hint">想改成退回到别的站，请在上面让 AI 改。</p>}
    </section>
  );
}

function HumanFail({ line, node }) {
  return (
    <section>
      <h3>不合格怎么办</h3>
      <p>退回「{titleOf(line, node.on_fail)}」，带上你写的理由。人工退回不限次数。</p>
    </section>
  );
}

// The rules of one node, for looking only (trial view, AI preview, and "what it was before").
function RulesView({ line, node }) {
  if (node.kind === 'station') {
    return (
      <>
        <section>
          <h3>规格</h3>
          <p className="hint">规格是写给工人看的说明：这一步要做什么、做成什么样。</p>
          <div className="box">{node.spec || '（空的）'}</div>
        </section>
        <StationFacts line={line} node={node} />
      </>
    );
  }
  if (isMachineGate(node)) {
    // list only the checks that are actually set
    const c = node.checks || {};
    const must = c.must_include || [];
    const set = [
      c.min_chars != null || c.max_chars != null
        ? `字数${c.min_chars != null ? `最少 ${c.min_chars}` : ''}${c.min_chars != null && c.max_chars != null ? '，' : ''}${c.max_chars != null ? `最多 ${c.max_chars}` : ''}` : null,
      c.single_paragraph ? '只有一段，不换行' : null,
      c.no_preamble ? '没有开场白、标题、列表符号' : null,
      must.length ? `必须原样出现这些文字：${must.map((s) => `「${s}」`).join('、')}` : null,
      c.keep_backticks_from ? backtickRule(c.keep_backticks_from) : null,
    ].filter(Boolean);
    return (
      <>
        <section>
          <h3>标准</h3>
          <dl><dt>谁来判</dt><dd>机器。程序自动查，不用 AI。</dd></dl>
          {set.length ? <ul>{set.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="hint amber">这道门现在没有设任何检查项，什么都能过。</p>}
          <p>同一件活最多写 {node.max_tries ?? '?'} 次，还不合格就停线。</p>
          <p className="hint">{ROUND_NOTE}</p>
        </section>
        <MachineFail line={line} node={node} readonly />
      </>
    );
  }
  if (isAiGate(node)) {
    return (
      <>
        <section>
          <h3>合格标准</h3>
          <dl><dt>谁来判</dt><dd>{AI_JUDGE}</dd><dt>对照</dt><dd>{referenceOf(node)}</dd></dl>
          <div className="box">{node.criteria || '（空的）'}</div>
          <p>同一件活最多写 {node.max_tries ?? '?'} 次，还不合格就停线。</p>
          <p className="hint">{ROUND_NOTE}</p>
        </section>
        <MachineFail line={line} node={node} readonly />
      </>
    );
  }
  return (
    <>
      <section>
        <h3>验收要点</h3>
        <dl><dt>谁来判</dt><dd>你</dd></dl>
        <div className="box">{node.points || '（空的）'}</div>
      </section>
      <HumanFail line={line} node={node} />
    </>
  );
}

function ReadonlyRules({ app, line, node }) {
  if (app.view !== 'proposal') return <RulesView line={line} node={node} />;
  const base = nodeById(app.baseLine, node.id);
  const changed = base && JSON.stringify(base) !== JSON.stringify(node);
  return (
    <>
      {!base && <div className="box warn">这个节点是 AI 新加的，现在的线上没有它。</div>}
      {changed && <div className="box warn">AI 改过这个节点。下面是改后的；最底下可以展开看改之前的。</div>}
      {base && !changed && <p className="hint">AI 没有动这个节点。</p>}
      <RulesView line={line} node={node} />
      {changed && (
        <details>
          <summary>改之前是这样（现在生效的）</summary>
          <RulesView line={app.baseLine} node={base} />
        </details>
      )}
    </>
  );
}

function StationRules({ app, line, node }) {
  const form = useDraft(app, `rules:${node.id}`, { spec: node.spec || '' });
  return (
    <>
      <VersionLine app={app} line={line} />
      <AiBox app={app} scope={node.id} what="这一步的规格" />
      <section>
        <h3>直接改规格</h3>
        <p className="hint">规格是写给工人看的说明：这一步要做什么、做成什么样。</p>
        <textarea rows={6} value={form.draft.spec} onChange={(e) => form.set({ spec: e.target.value })} />
        <SaveRow app={app} form={form} onSave={saveNode(app, form, node, () => ({ spec: form.draft.spec }))} />
      </section>
      <StationFacts line={line} node={node} />
    </>
  );
}

const asInt = (s) => (/^\d+$/.test(String(s).trim()) ? Number(s) : null);

function MachineGateRules({ app, line, node }) {
  const checks = node.checks || {};
  const form = useDraft(app, `rules:${node.id}`, {
    min: String(checks.min_chars ?? ''),
    max: String(checks.max_chars ?? ''),
    single: !!checks.single_paragraph,
    nopre: !!checks.no_preamble,
    must: (checks.must_include || []).join('\n'),
    tries: String(node.max_tries ?? ''),
  });
  const d = form.draft;
  const backTitle = titleOf(line, node.on_fail);
  // only the checks that are set (or that the user just added) are shown; the rest wait under "加一项检查"
  const [added, setAdded] = useState({});
  const show = {
    chars: !!added.chars || checks.min_chars != null || checks.max_chars != null || d.min !== '' || d.max !== '',
    single: !!added.single || !!checks.single_paragraph || d.single,
    nopre: !!added.nopre || !!checks.no_preamble || d.nopre,
    must: !!added.must || !!(checks.must_include || []).length || d.must !== '',
  };
  const hidden = [['chars', '字数上下限'], ['single', '只有一段，不换行'], ['nopre', '没有开场白、标题、列表符号'], ['must', '必须原样出现的文字']]
    .filter(([key]) => !show[key]);
  const addCheck = (key) => {
    setAdded((a) => ({ ...a, [key]: true }));
    if (key === 'single') form.set({ single: true });
    if (key === 'nopre') form.set({ nopre: true });
  };
  const save = (trial) => {
    // every check is optional: an empty box means "no limit" and is sent as null / []
    const blank = (s) => String(s).trim() === '';
    const min = blank(d.min) ? null : asInt(d.min), max = blank(d.max) ? null : asInt(d.max), tries = asInt(d.tries);
    if ((!blank(d.min) && min === null) || (!blank(d.max) && max === null)) { app.toast('字数填了就必须是 0 以上的整数；不想限制就留空。'); return; }
    if (min !== null && max !== null && min > max) { app.toast('字数的"最少"不能比"最多"大。'); return; }
    if (tries === null || tries < 1 || tries > 10) { app.toast('"最多写几次"要填 1 到 10 之间的整数。'); return; }
    const must = d.must.split('\n').map((s) => s.trim()).filter(Boolean);
    const patch = {
      checks: { min_chars: min, max_chars: max, single_paragraph: d.single ? true : null, no_preamble: d.nopre ? true : null, must_include: must },
      max_tries: tries,
    };
    saveNode(app, form, node, () => patch)(trial);
  };
  return (
    <>
      <VersionLine app={app} line={line} />
      <AiBox app={app} scope={node.id} what="这道门的标准" />
      <section>
        <h3>直接改标准</h3>
        <dl><dt>谁来判</dt><dd>机器。程序自动查，不用 AI。</dd></dl>
        {show.chars && (
          <div className="row">
            字数最少 <input type="number" min="0" value={d.min} placeholder="不限" onChange={(e) => form.set({ min: e.target.value })} />
            最多 <input type="number" min="0" value={d.max} placeholder="不限" onChange={(e) => form.set({ max: e.target.value })} />
            <span className="hint">留空表示不限</span>
          </div>
        )}
        {show.single && <div className="row"><label><input type="checkbox" checked={d.single} onChange={(e) => form.set({ single: e.target.checked })} /> 只有一段，不换行</label></div>}
        {show.nopre && <div className="row"><label><input type="checkbox" checked={d.nopre} onChange={(e) => form.set({ nopre: e.target.checked })} /> 没有开场白、标题、列表符号</label></div>}
        {show.must && (
          <>
            <p className="hint">产出里必须原样出现的文字（一行一条，比如小标题）。留空表示不查这一项。</p>
            <textarea value={d.must} placeholder={'比如：\n本周完成\n下周计划'} onChange={(e) => form.set({ must: e.target.value })} />
          </>
        )}
        {checks.keep_backticks_from && (
          <p className="hint">这道门另有一项检查，这里不能改，保存时也不会动它：{backtickRule(checks.keep_backticks_from)}。想改请在上面让 AI 改。</p>
        )}
        {!Object.values(show).some(Boolean) && !checks.keep_backticks_from && <p className="hint amber">这道门现在没有设任何检查项，什么都能过。</p>}
        {hidden.length > 0 && (
          <details className="more">
            <summary>加一项检查</summary>
            <div className="row">
              {hidden.map(([key, label]) => (
                <button key={key} className="btn small" onClick={() => addCheck(key)}>＋ {label}</button>
              ))}
            </div>
            <p className="hint">点一项，它就出现在上面，填好再保存。不保存就不算数。</p>
          </details>
        )}
        <div className="row">
          同一件活最多写 <input type="number" min="1" max="10" value={d.tries} onChange={(e) => form.set({ tries: e.target.value })} /> 次，还不合格就停线
        </div>
        <p className="hint">{ROUND_NOTE}</p>
        <SaveRow
          app={app} form={form} onSave={save}
          extra={`这些要求只存在这道门上，「${backTitle}」的工人会自动按新的要求写，两处不会对不上。但${productNote(line)}`}
        />
      </section>
      <MachineFail line={line} node={node} />
    </>
  );
}

function AiGateRules({ app, line, node }) {
  const form = useDraft(app, `rules:${node.id}`, { criteria: node.criteria || '', tries: String(node.max_tries ?? '') });
  const d = form.draft;
  const backTitle = titleOf(line, node.on_fail);
  const save = (trial) => {
    const tries = asInt(d.tries);
    if (!d.criteria.trim()) { app.toast('合格标准不能是空的，不然 AI 质检员不知道按什么判。'); return; }
    if (tries === null || tries < 1 || tries > 10) { app.toast('"最多写几次"要填 1 到 10 之间的整数。'); return; }
    saveNode(app, form, node, () => ({ criteria: d.criteria, max_tries: tries }))(trial);
  };
  return (
    <>
      <VersionLine app={app} line={line} />
      <AiBox app={app} scope={node.id} what="这道门的合格标准" />
      <section>
        <h3>直接改合格标准</h3>
        <dl><dt>谁来判</dt><dd>{AI_JUDGE}</dd><dt>对照</dt><dd>{referenceOf(node)}</dd></dl>
        <p className="hint">一行写一条，要具体到能判对错。</p>
        <textarea rows={5} value={d.criteria} onChange={(e) => form.set({ criteria: e.target.value })} />
        <div className="row">
          同一件活最多写 <input type="number" min="1" max="10" value={d.tries} onChange={(e) => form.set({ tries: e.target.value })} /> 次，还不合格就停线
        </div>
        <p className="hint">{ROUND_NOTE}</p>
        <SaveRow
          app={app} form={form} onSave={save}
          extra={`这些标准只存在这道门上，「${backTitle}」的工人干活前也会看到它们。但${productNote(line)}`}
        />
      </section>
      <MachineFail line={line} node={node} />
    </>
  );
}

function HumanGateRules({ app, line, node }) {
  const form = useDraft(app, `rules:${node.id}`, { points: node.points || '' });
  return (
    <>
      <VersionLine app={app} line={line} />
      <AiBox app={app} scope={node.id} what="这道门的验收要点" />
      <section>
        <h3>直接改验收要点</h3>
        <dl><dt>谁来判</dt><dd>你</dd></dl>
        <p className="hint">写给自己看：验收时要看什么。</p>
        <textarea value={form.draft.points} onChange={(e) => form.set({ points: e.target.value })} />
        <SaveRow app={app} form={form} onSave={saveNode(app, form, node, () => ({ points: form.draft.points }))} />
      </section>
      <HumanFail line={line} node={node} />
    </>
  );
}

function RulesTab({ app, line, node }) {
  if (node.id === STOP_ID) {
    return (
      <section>
        <h3>停线是什么</h3>
        <p>一件活重做到上限还不合格，或者某一步出错、卡住，就停在这里等你处理。不合格的东西不会流到后面。</p>
        <p className="hint">上限是多少，在各道机器门的规矩里改。</p>
      </section>
    );
  }
  if (node.kind === 'source' || node.kind === 'product') {
    return (
      <section>
        <h3>{kindName(node)}</h3>
        <p>{node.kind === 'source' ? `这条线收的原料是：${line.input}。` : `这条线交的成品是：${line.output}。`}</p>
        <p className="hint">存成文件 {node.file}。想改原料或成品是什么，等于改整条线。请在页面上方对整条线提意见。</p>
      </section>
    );
  }
  if (app.readonly) return <ReadonlyRules app={app} line={line} node={node} />;
  if (node.kind === 'station') return <StationRules app={app} line={line} node={node} />;
  if (isMachineGate(node)) return <MachineGateRules app={app} line={line} node={node} />;
  if (isAiGate(node)) return <AiGateRules app={app} line={line} node={node} />;
  return <HumanGateRules app={app} line={line} node={node} />;
}

// ---------- panel shell ----------

export default function Panel({ app, line, item, detailLoaded, sel, tab, onTab }) {
  const node = sel ? nodeById(line, sel) : null;
  if (!node) return <aside className="card panel"><LineAbout app={app} line={line} /></aside>;
  const state = nodeState(node, item);
  const scope = tab === 'item'
    ? (app.readonly ? '这是试跑的活，只能看。' : item ? `下面的操作只影响${item.name}。` : '这里显示某一件活在这一步的情况。')
    : (app.view === 'proposal' ? '这是 AI 改后的规矩，还没生效，这里不能改。'
      : app.view === 'trial' ? '这是现在这一版的规矩，这里只能看。想改，先点上面的"回到正式的活"。'
      : '下面的改动影响以后所有的活。');
  return (
    <aside className="card panel">
      <h2>
        {node.title}
        <span className="tag">{kindName(node)}</span>
        {item && <span className="tag">{item.name}：{stateText(node, state)}</span>}
      </h2>
      <div className="tabs">
        <button className={cx(tab === 'item' && 'on')} onClick={() => onTab('item')}>这件活</button>
        <button className={cx(tab === 'rules' && 'on')} onClick={() => onTab('rules')}>这一站的规矩</button>
      </div>
      <p className={cx('scope', app.readonly && 'ro')}>{scope}</p>
      {tab === 'item'
        ? <ItemTab key={`${app.view}|${item?.id}|${node.id}`} app={app} line={line} node={node} item={item} state={state} detailLoaded={detailLoaded} />
        : <RulesTab key={`${app.view}|${node.id}`} app={app} line={line} node={node} />}
    </aside>
  );
}
