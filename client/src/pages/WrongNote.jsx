import { useEffect, useState } from 'react';
import { EmptyState, PageCard, PageContainer, PageHeader } from '../components/PageLayout.jsx';

const apiBase = import.meta.env.VITE_API_URL || '';

export default function WrongNote() {
  const [attempts, setAttempts] = useState([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState('');
  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [err, setErr] = useState('');

  async function loadAttempts() {
    setLoadingAttempts(true);
    setErr('');
    try {
      const res = await fetch(`${apiBase}/api/exam/attempts`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '시험 이력 조회 실패');
      const list = Array.isArray(data.attempts) ? data.attempts : [];
      setAttempts(list);
      if (!selectedAttemptId && list.length > 0) {
        setSelectedAttemptId(list[0].id);
      }
    } catch (e) {
      setErr(e.message || '시험 이력을 불러오지 못했습니다.');
    } finally {
      setLoadingAttempts(false);
    }
  }

  useEffect(() => {
    loadAttempts();
  }, []);

  useEffect(() => {
    if (!selectedAttemptId) {
      setSelectedAttempt(null);
      return;
    }
    async function loadAttemptDetail() {
      setLoadingDetail(true);
      setErr('');
      try {
        const res = await fetch(`${apiBase}/api/exam/attempts/${selectedAttemptId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '시험 상세 조회 실패');
        setSelectedAttempt(data.attempt || null);
      } catch (e) {
        setErr(e.message || '시험 상세를 불러오지 못했습니다.');
        setSelectedAttempt(null);
      } finally {
        setLoadingDetail(false);
      }
    }
    loadAttemptDetail();
  }, [selectedAttemptId]);

  return (
    <PageContainer>
      <PageHeader title="시험 기록" description="응시 회차를 선택하면 그때의 맞춤/오답을 확인할 수 있습니다." />
      {err ? <p className="mt-2 text-sm text-rose-400">{err}</p> : null}

      <PageCard className="mt-6 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">최근 시험 회차</p>
          <button type="button" onClick={loadAttempts} disabled={loadingAttempts} className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300">
            {loadingAttempts ? '갱신 중…' : '새로고침'}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {attempts.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelectedAttemptId(a.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                selectedAttemptId === a.id ? 'bg-accent text-white' : 'border border-slate-600 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {i + 1}회차 · {a.percent}점 ({a.correct}/{a.total})
            </button>
          ))}
        </div>
      </PageCard>

      <ul className="mt-8 space-y-4">
        {attempts.length === 0 ? <li><EmptyState text="아직 저장된 시험 기록이 없습니다." /></li> : null}
        {loadingDetail ? <li><EmptyState text="선택한 시험 기록을 불러오는 중입니다." /></li> : null}
        {selectedAttempt?.items?.map((w) => (
          <PageCard key={w.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-100">Q{w.orderNo}. {w.question}</p>
              <span className={`rounded px-2 py-0.5 text-[11px] ${w.isCorrect ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                {w.isCorrect ? '정답' : '오답'}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              토픽: {w.topic || '-'} · 내 답: {w.picked >= 0 ? (w.options?.[w.picked] ?? `선택 ${w.picked + 1}`) : '미응답'} · 정답: {w.options?.[w.answer] ?? w.answer}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-xs text-slate-400">{w.explanation}</p>
          </PageCard>
        ))}
      </ul>
    </PageContainer>
  );
}
