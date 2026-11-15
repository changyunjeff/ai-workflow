import { useState } from 'react';
import { cx } from './graph.js';

// Long text (an AI inspector's full reasons, say) folded to two lines, with a way to read all of it.
export default function Clamp({ text, limit = 64, className }) {
  const [open, setOpen] = useState(false);
  const s = String(text ?? '');
  if (s.length <= limit) return <span className={className}>{s}</span>;
  return (
    <span className={cx('clamp', open && 'open', className)}>
      <span className="clamptext">{s}</span>
      <button className="link" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>{open ? '收起' : '展开全部'}</button>
    </span>
  );
}
