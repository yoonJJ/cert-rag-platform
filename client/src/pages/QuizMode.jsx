import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api.js';
import QuestionCard from '../components/QuestionCard.jsx';
import TutorPanel from '../components/TutorPanel.jsx';
import { EmptyState, PageCard, PageContainer, PageHeader } from '../components/PageLayout.jsx';

export default function QuizMode() {
  const [command, setCommand] = useState('');
  const [source, setSource] = useState('');
  const [sources, setSources] = useState([]);
  const [count, setCount] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [showKey, setShowKey] = useState(false);
  const [tutor, setTutor] = useState(null);
  const [err, setErr] = useState('');
  const normalizedCount = Math.min(Math.max(Number(count) || 1, 1), 20);
  const answeredCount = questions.filter((item) => Object.prototype.hasOwnProperty.call(answers, item.id)).length;
  const progress = questions.length ? Math.round(((idx + 1) / questions.length) * 100) : 0;
  const canGenerate = Boolean(source) && Boolean(command.trim()) && !isGenerating;

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

  async function generate() {
    setErr('');
    setIsGenerating(true);
    try {
      const data = await apiJson('/api/questions/generate', {
        method: 'POST',
        body: JSON.stringify({ command, examType: 'PDF기반', source, count: normalizedCount }),
      });
      setQuestions(data.questions || []);
      setAnswers({});
      setIdx(0);
      setShowKey(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setIsGenerating(false);
    }
  }

  const q = questions[idx];

  return (
    <PageContainer>
      <PageHeader title="문제 풀기" description="시험을 고르고 자연어로 출제 지시를 입력하세요." />

      <PageCard className="mt-6">
        <p className="mb-3 text-xs text-slate-500">1) 파일 선택 2) 출제 지시 입력 3) 문제 생성</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
          <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm sm:col-span-1 xl:col-span-3">
            <option value="">{isLoadingMeta ? '파일 목록 로딩 중...' : '파일 선택'}</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="예: 데이터베이스 과목에서 기본 문제 만들어줘"
            className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm sm:col-span-2 xl:col-span-6"
          />
          <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm sm:col-span-1 xl:col-span-1" />
          <button
            type="button"
            onClick={generate}
            disabled={!canGenerate}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-1 xl:col-span-2"
          >
            {isGenerating ? '생성 중…' : `${normalizedCount}문제 생성`}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">문제 개수는 1~20개까지 설정할 수 있습니다. (현재 {normalizedCount}개)</p>
        {!source || !command.trim() ? <p className="mt-2 text-xs text-amber-300">파일과 출제 지시를 입력해야 생성할 수 있습니다.</p> : null}
      </PageCard>
      {isGenerating ? <p className="mt-2 text-xs text-slate-400">문제를 생성하는 중입니다. 잠시만 기다려 주세요…</p> : null}
      {err ? <p className="mt-2 text-sm text-rose-400">{err}</p> : null}

      {questions.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>{idx + 1} / {questions.length}</span>
            <span>응답 {answeredCount}/{questions.length}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800">
            <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))} className="rounded border border-slate-600 px-2 py-1 text-xs disabled:opacity-40">이전</button>
            <button type="button" disabled={idx >= questions.length - 1} onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))} className="rounded border border-slate-600 px-2 py-1 text-xs disabled:opacity-40">다음</button>
          </div>
        </div>
      ) : null}

      {q ? (
        <div className="mt-6 space-y-4">
          <QuestionCard question={q.question} options={q.options} selected={answers[q.id]} onSelect={(i) => setAnswers((a) => ({ ...a, [q.id]: i }))} disabled={showKey} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowKey((s) => !s)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">{showKey ? '정답 숨기기' : '정답 보기'}</button>
            <button type="button" onClick={() => setTutor({ question: q.question, wrongAnswer: q.options?.[answers[q.id]] ?? '', correctAnswer: q.options?.[q.answer] ?? String(q.answer), topic: q.topic || command })} className="rounded-lg border border-violet-500/50 bg-violet-500/10 px-4 py-2 text-sm text-violet-200 hover:bg-violet-500/20">AI 튜터</button>
          </div>
          {showKey ? (
            <div className="rounded-lg border border-slate-600 bg-slate-900/80 p-4 text-sm text-slate-300">
              <p>정답: {q.options?.[q.answer] ?? q.answer}</p>
              <p className="mt-2 whitespace-pre-wrap text-slate-400">{q.explanation}</p>
              {q.sourceDoc ? <p className="mt-3 text-xs text-slate-500">출처: {q.sourceDoc}</p> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState text="문제를 생성하면 여기에 표시됩니다." className="mt-8" />
      )}

      <TutorPanel open={!!tutor} onClose={() => setTutor(null)} question={tutor?.question} wrongAnswer={tutor?.wrongAnswer} correctAnswer={tutor?.correctAnswer} topic={tutor?.topic} />
    </PageContainer>
  );
}
