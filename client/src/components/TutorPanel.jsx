import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const apiBase = import.meta.env.VITE_API_URL || '';

function tutorUrl(params) {
  const q = new URLSearchParams(params);
  return `${apiBase}/api/tutor?${q}`;
}

export default function TutorPanel({ question, wrongAnswer, correctAnswer, topic, open, onClose }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const esRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setText('');
      setLoading(false);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      return;
    }

    setText('');
    setLoading(true);
    const url = tutorUrl({
      question: question || '',
      wrongAnswer: wrongAnswer ?? '',
      correctAnswer: correctAnswer ?? '',
      topic: topic || '',
    });

    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (ev) => {
      if (ev.data === '[DONE]') {
        setLoading(false);
        es.close();
        return;
      }
      try {
        const j = JSON.parse(ev.data);
        if (j.error) {
          setText((t) => t + `\n[오류] ${j.error}`);
          setLoading(false);
          es.close();
          return;
        }
        if (j.text) setText((t) => t + j.text);
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      setLoading(false);
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [open, question, wrongAnswer, correctAnswer, topic]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-600 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-white">AI 튜터</h3>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white">
            닫기
          </button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto bg-slate-900/95 p-6 text-[13px] leading-7 text-slate-200">
          {loading && !text ? (
            '답변 생성 중…'
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h4 className="mt-5 text-lg font-semibold text-white">{children}</h4>,
                h2: ({ children }) => <h5 className="mt-4 text-base font-semibold text-white">{children}</h5>,
                h3: ({ children }) => <h6 className="mt-3 text-sm font-semibold text-slate-100">{children}</h6>,
                p: ({ children }) => <p className="my-2.5 whitespace-pre-wrap break-words text-slate-200">{children}</p>,
                ul: ({ children }) => <ul className="my-2.5 list-disc space-y-1.5 pl-5 text-slate-200">{children}</ul>,
                ol: ({ children }) => <ol className="my-2.5 list-decimal space-y-1.5 pl-5 text-slate-200">{children}</ol>,
                li: ({ children }) => <li className="text-slate-200">{children}</li>,
                code: ({ inline, children }) =>
                  inline ? (
                    <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-emerald-200">{children}</code>
                  ) : (
                    <code className="block overflow-x-auto whitespace-pre rounded-lg border border-slate-700 bg-slate-950 p-3 text-[12px] leading-6 text-emerald-200">{children}</code>
                  ),
                table: ({ children }) => (
                  <div className="my-3 overflow-x-auto rounded-lg border border-slate-700 bg-slate-950/40">
                    <table className="w-full min-w-full border-collapse text-[12px]">{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-slate-800/75 text-slate-100">{children}</thead>,
                tbody: ({ children }) => <tbody className="divide-y divide-slate-800/80">{children}</tbody>,
                th: ({ children }) => <th className="border-b border-slate-700 px-3 py-2 text-left text-[11px] font-semibold text-slate-200">{children}</th>,
                tr: ({ children }) => <tr className="align-top">{children}</tr>,
                td: ({ children }) => <td className="px-3 py-2 align-top whitespace-pre-wrap break-words text-slate-200">{children}</td>,
                blockquote: ({ children }) => (
                  <blockquote className="my-3 border-l-2 border-accent/70 bg-slate-800/40 px-3 py-2 text-slate-300">
                    {children}
                  </blockquote>
                ),
                hr: () => <hr className="my-3 border-slate-700" />,
              }}
            >
              {text || ''}
            </ReactMarkdown>
          )}
          {loading && text ? <span className="inline-block h-4 w-1 animate-pulse bg-accent align-middle" /> : null}
        </div>
      </div>
    </div>
  );
}
