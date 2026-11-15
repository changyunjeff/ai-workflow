import { useEffect, useState } from 'react';
import { api } from './api.js';
import { readTextFile } from './FeedDialog.jsx';

// The samples of a line: the materials every trial run is checked against.
export default function SamplesDialog({ app, line, onClose }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const samples = line.samples || [];
  const results = new Map((line.trial?.samples || []).map((s) => [s.name, s]));
  const last = samples.length <= 1;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProblem('');
    if (file.size > 2 * 1024 * 1024) { setProblem('这个文件超过 2MB，不像是一份文字原料。'); return; }
    let content;
    try { content = await readTextFile(file); } catch { setProblem('这个文件读不出来。'); return; }
    if (content.includes('\u0000')) { setProblem('这个文件不是纯文本（比如 Word、PDF、图片），读不成文字。请把内容复制出来粘贴到下面。'); return; }
    setText(content);
    setName((n) => n || file.name.replace(/\.[^.]+$/, ''));
  };

  const add = async () => {
    const res = await app.act(() => api.addSample(name.trim(), text), (r) => `已加进样例「${r.name || name.trim()}」，下次试跑会把它也跑一遍。`);
    if (res) { setName(''); setText(''); }
  };
  const remove = (s) => {
    if (!window.confirm(`确定删掉样例「${s.name}」吗？\n删掉之后试跑不再检查这份原料。删了找不回来。`)) return;
    app.act(() => api.removeSample(s.name), `已删掉样例「${s.name}」。`);
  };

  const count = [...text.replace(/\s/g, '')].length;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="样例">
        <h2>样例（{samples.length} 份）</h2>
        <p className="hint">试跑会把每一份样例都跑一遍。只在一份样例上走通，证明不了换一份原料也能走通。</p>
        {samples.length === 0 && <p className="hint amber">这条线还没有样例，没法试跑。先在下面加一份。</p>}
        <ul className="versions">
          {samples.map((s) => {
            const r = results.get(s.name);
            return (
              <li key={s.name}>
                <div className="row" style={{ margin: 0 }}>
                  <b>{s.name}</b>
                  <span className="hint">{s.chars} 字</span>
                  {r && <span className={r.ok >= r.runs ? 'tone good' : r.ok > 0 ? 'tone warn' : 'tone bad'}>这一版试跑 {r.runs} 次，走通 {r.ok} 次</span>}
                  <span className="spacer" />
                  <button className="btn small bad" disabled={last || app.busy} onClick={() => remove(s)}>删掉</button>
                </div>
              </li>
            );
          })}
        </ul>
        {last && samples.length === 1 && <p className="hint amber">只剩这一份，不能删：至少要留一份样例，不然没法试跑。</p>}
        <p className="hint">删掉：试跑不再检查这份原料。点了会先问你一遍，删了找不回来。</p>

        <h2 style={{ marginTop: 12 }}>加一份样例</h2>
        <p className="hint">这条线收的原料是：{line.input}。挑一份和已有样例不一样的（更长的、更乱的、容易出错的）。</p>
        <div className="row">
          <span>名字</span>
          <input
            type="text" style={{ flex: 1, minWidth: 180, width: 'auto' }} maxLength={40} value={name}
            placeholder="可不填。起个能认出它的名字，比如：长会-活动复盘" onChange={(e) => setName(e.target.value)}
          />
        </div>
        <textarea value={text} placeholder="把原料粘贴到这里" style={{ minHeight: 140 }} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <label className="btn">
            选一个文本文件
            <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden onChange={pickFile} />
          </label>
          <span className="hint">现在有 {count} 个字</span>
        </div>
        {problem && <p className="hint" style={{ color: 'var(--red)' }}>{problem}</p>}
        <div className="row">
          <button className="btn primary" disabled={app.busy || !text.trim()} onClick={add}>加进样例</button>
          <button className="btn" onClick={onClose}>关掉</button>
          <span className="hint">{text.trim() ? '加进样例之后，下次试跑会把它也跑一遍。已经跑完的试跑结果不变。' : '还没有内容，所以不能加。'}</span>
        </div>
      </div>
    </div>
  );
}
