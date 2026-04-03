import { useState, useMemo, useEffect, useRef } from 'react';
import { apiJson } from '../lib/api.js';
import { useExam } from '../hooks/useExam.js';
import QuestionCard from '../components/QuestionCard.jsx';
import Timer from '../components/Timer.jsx';
import { PageCard, PageContainer, PageHeader } from '../components/PageLayout.jsx';

export default function ExamMode() {
  const [command, setCommand] = useState('');
  const [source, setSource] = useState('');
  const [sources, setSources] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [graded, setGraded] = useState(null);
  const [err, setErr] = useState('');

  const cfg = useMemo(() => ({ questions: 10, minutes: 30, passPercent: 60 }), []);
  const exam = useExam(questions, cfg.minutes);
  const answeredCount = questions.filter((item) => Object.prototype.hasOwnProperty.call(exam.answers, item.id)).length;
  const progress = questions.length ? Math.round(((exam.current + 1) / questions.length) * 100) : 0;
  const canStart = Boolean(source) && Boolean(command.trim()) && !isGenerating;

  useEffect(() => {
    let mounted = true;
    async function loadSources() {
      setIsLoadingMeta(true);
      try {
        const data = await apiJson('/api/sources');
        if (!mounted) return;
        const src = Array.isArray(data.sources) ? data.sources : [];
        setSources(src);
        if (src.length > 0) {
          setSource(src[0]);
        }
      } catch {
        if (mounted) {
          setSources([]);
        }
      } finally {
        if (mounted) setIsLoadingMeta(false);
      }
    }
    loadSources();
    return () => {
      mounted = false;
    };
  }, []);

  async function start() {
    setErr('');
    setGraded(null);
    setIsGenerating(true);
    try {
      const data = await apiJson('/api/questions/generate', {
        method: 'POST',
        body: JSON.stringify({ command, examType: 'PDF기반', source, count: Math.min(cfg.questions, 20) }),
      });
      setQuestions(data.questions || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function finish() {
    exam.submit();
    try {
      const data = await apiJson('/api/exam/grade', {
        method: 'POST',
        body: JSON.stringify({ questions, answers: exam.answers, examType: 'PDF기반', source, command }),
      });
      setGraded(data);
    } catch (e) {
      setErr(e.message);
    }
  }

  const q = questions[exam.current];
  const savedRef = useRef(false);

  useEffect(() => {
    if (!graded?.details || !questions.length || savedRef.current) return;
    savedRef.current = true;
    const apiBase = import.meta.env.VITE_API_URL || '';
    graded.details.forEach((d) => {
      if (d.correct) return;
      const item = questions.find((x) => x.id === d.id);
      if (!item) return;
      fetch(`${apiBase}/api/wrong`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: item.question,
          options: item.options,
          myAnswer: d.picked ?? -1,
          correctAnswer: item.answer,
          explanation: item.explanation,
          topic: item.topic || command,
          examType: 'PDF기반',
        }),
      }).catch(() => {});
    });
  }, [graded, questions, command]);

  useEffect(() => {
    savedRef.current = false;
  }, [questions]);

  return (
    <PageContainer>
      <PageHeader title="시험 시뮬레이션" description="시험을 고르고 자연어로 출제 범위를 지시하세요." />

      <PageCard className="mt-6 space-y-3">
        <div className="text-xs text-slate-500">{cfg.questions}문항 / {cfg.minutes}분 (문제 생성 최대 20개)</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
          <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm sm:col-span-1 xl:col-span-3">
            <option value="">{isLoadingMeta ? '파일 목록 로딩 중...' : '파일 선택'}</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="예: 네트워크 과목 위주로 실전형 문제 만들어줘"
            className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm sm:col-span-2 xl:col-span-7"
          />
          <button
            type="button"
            onClick={start}
            disabled={!canStart}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-1 xl:col-span-2"
          >
            {isGenerating ? '문제 생성 중…' : '시험 시작'}
          </button>
        </div>
        {!source || !command.trim() ? <p className="text-xs text-amber-300">파일과 출제 범위를 입력해야 시작할 수 있습니다.</p> : null}
      </PageCard>
      {isGenerating ? <p className="mt-2 text-xs text-slate-400">시험 문제를 생성하는 중입니다. 잠시만 기다려 주세요…</p> : null}

      {err ? <p className="mt-2 text-sm text-rose-400">{err}</p> : null}

      {questions.length > 0 && !graded ? (
        <div className="mt-6 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Timer label="남은 시간" value={exam.formatTime()} urgent={exam.timeLeft < 300} />
            <div className="text-sm text-slate-400">
              {exam.current + 1} / {questions.length} · 응답 {answeredCount}/{questions.length}
            </div>
          </div>
          <div className="h-2 rounded-full bg-slate-800">
            <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}

      {q && !graded ? (
        <div className="mt-6 space-y-4">
          <QuestionCard question={q.question} options={q.options} selected={exam.answers[q.id]} onSelect={(i) => exam.select(q.id, i)} disabled={exam.submitted} />
          <p className="text-xs text-slate-500">출처: {q.sourceDoc || '—'}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={exam.current === 0} onClick={() => exam.setCurrent((c) => Math.max(0, c - 1))} className="rounded-lg border border-slate-600 px-4 py-2 text-sm disabled:opacity-40">이전</button>
            <button type="button" disabled={exam.current >= questions.length - 1} onClick={() => exam.setCurrent((c) => Math.min(questions.length - 1, c + 1))} className="rounded-lg border border-slate-600 px-4 py-2 text-sm disabled:opacity-40">다음</button>
            <button type="button" onClick={finish} disabled={exam.submitted} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">채점 제출</button>
          </div>
        </div>
      ) : null}

      {graded ? (
        <PageCard className="mt-8 space-y-6 bg-slate-900/50 p-6">
          <div>
            <h2 className="text-lg font-semibold text-white">결과</h2>
            <p className="mt-2 text-3xl font-bold text-accent">{graded.percent}점</p>
            <p className="text-sm text-slate-400">{graded.correct} / {graded.total} 정답</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-300">문항별 채점 결과</h3>
            <ul className="mt-3 space-y-2">
              {(graded.details || []).map((item) => (
                <li key={item.id} className="rounded-xl border border-slate-700/80 bg-slate-950/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-slate-100">
                      <span className="mr-2 text-slate-400">#{item.orderNo}</span>
                      {item.question}
                    </p>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${
                        item.correct ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {item.correct ? '정답' : '오답'}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-slate-300 sm:grid-cols-2">
                    <p>
                      내 답:{' '}
                      <span className={item.correct ? 'text-emerald-300' : 'text-rose-300'}>
                        {item.picked >= 0 ? item.options?.[item.picked] ?? `선택 ${item.picked + 1}` : '미응답'}
                      </span>
                    </p>
                    <p>
                      정답: <span className="text-emerald-300">{item.options?.[item.answer] ?? `정답 ${item.answer + 1}`}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </PageCard>
      ) : null}
    </PageContainer>
  );
}
