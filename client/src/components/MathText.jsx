import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// 텍스트에서 LaTeX 수식($...$, $$...$$)만 골라 실제 수식(분수 등)으로 렌더링하고,
// 나머지 텍스트는 원문 그대로(줄바꿈 보존) 표시합니다. 마크다운 파서를 쓰지 않아
// 전사 텍스트의 [ ] _ * # 같은 문자를 오해하지 않습니다.
function splitMath(text) {
  const parts = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
    if (m[1] !== undefined) parts.push({ type: 'math', value: m[1], display: true, raw: m[0] });
    else parts.push({ type: 'math', value: m[2], display: false, raw: m[0] });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

function renderKatex(tex, displayMode) {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, errorColor: '#fca5a5' });
  } catch {
    return null;
  }
}

export default function MathText({ children, className = '' }) {
  const text = String(children ?? '');
  const parts = useMemo(() => splitMath(text), [text]);

  return (
    <span className={`mathtext whitespace-pre-wrap break-words ${className}`}>
      {parts.map((p, i) => {
        if (p.type === 'text') return <span key={i}>{p.value}</span>;
        const html = renderKatex(p.value, p.display);
        if (html == null) return <span key={i}>{p.raw}</span>;
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </span>
  );
}
