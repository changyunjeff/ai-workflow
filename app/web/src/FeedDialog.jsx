import { useEffect, useRef, useState } from 'react';

// Read a local text file in the browser. Falls back to GB18030 for files saved by older
// Chinese Windows programs, which are not UTF-8.
export async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) {
    try { text = new TextDecoder('gb18030').decode(buf); } catch { /* keep the UTF-8 reading */ }
  }
  return text.replace(/^﻿/, '');
}

export default function FeedDialog({ line, busy, onSubmit, onClose }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState('');
  const box = useRef(null);

  useEffect(() => { box.current?.focus(); }, []);
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
    if (file.size > 2 * 1024 * 1024) { setProblem('这个文件超过 2MB，不像是一篇文字原料。'); return; }
    let content;
    try { content = await readTextFile(file); } catch { setProblem('这个文件读不出来。'); return; }
    if (content.includes('\u0000')) { setProblem('这个文件不是纯文本（比如 Word、PDF、图片），读不成文字。请把内容复制出来粘贴到上面。'); return; }
    setText(content);
    setFileName(file.name);
    setTitle((t) => t || file.name.replace(/\.[^.]+$/, ''));
  };

  const count = [...text.replace(/\s/g, '')].length;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="投新料">
        <h2>投新料</h2>
        <p className="hint">这条线收的原料是：{line.input}。把它粘贴到下面，或者选一个文本文件。看一眼没问题，再点"开始"。</p>
        <textarea
          ref={box} value={text} placeholder="把原料粘贴到这里"
          onChange={(e) => { setText(e.target.value); setFileName(''); }}
        />
        <div className="row">
          <label className="btn">
            选一个文本文件
            <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden onChange={pickFile} />
          </label>
          <span className="hint">{fileName ? `已读入 ${fileName}，` : ''}现在有 {count} 个字</span>
        </div>
        {problem && <p className="hint" style={{ color: 'var(--red)' }}>{problem}</p>}
        <div className="row">
          <span>名字</span>
          <input
            type="text" style={{ flex: 1, minWidth: 180, width: 'auto' }} maxLength={40} value={title}
            placeholder="可不填。起个名字，以后在一堆活里好认" onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="row">
          <button className="btn primary" disabled={busy || !text.trim()} onClick={() => onSubmit(text, title.trim())}>开始</button>
          <button className="btn" onClick={onClose}>取消</button>
          <span className="hint">{text.trim() ? '点"开始"后，这件活会从第一站开始做，页面会切到它。' : '还没有原料，所以不能开始。'}</span>
        </div>
      </div>
    </div>
  );
}
