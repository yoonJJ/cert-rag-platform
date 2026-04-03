import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { EmptyState, PageCard, PageContainer, PageHeader } from '../components/PageLayout.jsx';
import { useLlmStatus } from '../context/LlmStatusContext.jsx';

const apiBase = import.meta.env.VITE_API_URL || '';

function getStatusUi(status) {
  const state = status?.state || 'down';
  if (state === 'connected') {
    return {
      label: 'CONNECTED',
      tone: 'text-emerald-300 border-emerald-500/50 bg-emerald-500/10',
      dot: 'bg-emerald-400',
      speedMs: 1500,
    };
  }
  if (state === 'degraded') {
    return {
      label: 'DEGRADED',
      tone: 'text-amber-300 border-amber-500/50 bg-amber-500/10',
      dot: 'bg-amber-400',
      speedMs: 900,
    };
  }
  return {
    label: 'DOWN',
    tone: 'text-rose-300 border-rose-500/50 bg-rose-500/10',
    dot: 'bg-rose-400',
    speedMs: 650,
  };
}

function ConnectionStatusCard({ title, status, fallbackText }) {
  const ui = getStatusUi(status);
  return (
    <PageCard className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h2>
        <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${ui.tone}`}>
          <span className={`relative inline-flex h-2.5 w-2.5 items-center justify-center`}>
            <span
              className={`absolute inline-flex h-2.5 w-2.5 rounded-full opacity-60 ${ui.dot} animate-ping`}
              style={{ animationDuration: `${ui.speedMs}ms` }}
            />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${ui.dot}`} />
          </span>
          {ui.label}
        </span>
      </div>
      <p className="mt-2 text-lg font-semibold text-white">
        {status?.ok ? '연결 정상' : '점검 필요'}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        {typeof status?.latencyMs === 'number' ? `지연 ${status.latencyMs}ms` : fallbackText}
      </p>
    </PageCard>
  );
}

export default function Dashboard() {
  const { model: llmModel, label: llmLabel, options: llmOptions, error: llmContextErr, refresh: refreshLlm } =
    useLlmStatus();
  const [health, setHealth] = useState(null);
  const [files, setFiles] = useState([]);
  const [wrongItems, setWrongItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filesErr, setFilesErr] = useState('');
  const [wrongErr, setWrongErr] = useState('');
  const [llmSettingsErr, setLlmSettingsErr] = useState('');
  const [llmSaving, setLlmSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function loadDashboard() {
      setIsLoading(true);
      try {
        const [healthRes, filesRes, wrongRes] = await Promise.allSettled([
          fetch(`${apiBase}/api/health`).then((r) => r.json()),
          fetch(`${apiBase}/api/sources/stats`).then((r) => r.json()),
          fetch(`${apiBase}/api/wrong`).then((r) => r.json()),
        ]);

        if (!mounted) return;

        if (healthRes.status === 'fulfilled') {
          setHealth(healthRes.value);
        } else {
          setHealth({ ok: false, db: false });
        }

        if (filesRes.status === 'fulfilled') {
          setFiles(Array.isArray(filesRes.value.files) ? filesRes.value.files : []);
        } else {
          setFilesErr('학습 소스 목록을 불러오지 못했습니다.');
        }

        if (wrongRes.status === 'fulfilled') {
          setWrongItems(Array.isArray(wrongRes.value.items) ? wrongRes.value.items : []);
        } else {
          setWrongErr('오답 노트를 불러오지 못했습니다.');
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadDashboard();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleLlmChange(nextId) {
    if (!nextId || nextId === llmModel) return;
    setLlmSaving(true);
    setLlmSettingsErr('');
    try {
      const res = await fetch(`${apiBase}/api/settings/llm`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: nextId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLlmSettingsErr(data.error || '모델 변경에 실패했습니다.');
        return;
      }
      await refreshLlm();
      const healthRes = await fetch(`${apiBase}/api/health`).then((r) => r.json());
      setHealth(healthRes);
    } catch {
      setLlmSettingsErr('모델 변경 요청 중 오류가 났습니다.');
    } finally {
      setLlmSaving(false);
    }
  }

  const totalChunks = useMemo(() => files.reduce((sum, f) => sum + (Number(f.chunkCount) || 0), 0), [files]);
  const examTypeCount = useMemo(() => new Set(files.map((f) => f.examType).filter(Boolean)).size, [files]);
  const recentFiles = useMemo(() => files.slice(-5).reverse(), [files]);
  const wrongRateLabel = useMemo(() => {
    const solvedCount = wrongItems.length;
    if (solvedCount === 0) return '오답 0건';
    if (solvedCount < 5) return '복습 시작 단계';
    if (solvedCount < 15) return '복습 진행 중';
    return '집중 복습 필요';
  }, [wrongItems]);

  return (
    <PageContainer>
      <PageHeader title="학습 현황" description="학습 데이터 상태와 오늘의 액션을 한 번에 확인하세요." />

      <div className="mb-4 grid gap-3 sm:gap-4 xl:grid-cols-3">
        <PageCard className="p-4 sm:p-5 xl:col-span-3">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch lg:justify-between">
            <div className="min-w-0 flex-1 rounded-xl border border-slate-700/80 bg-slate-950/50 p-4">
              <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">현재 사용 중인 LLM</h2>
              <p className="mt-2 truncate text-xl font-semibold text-white">{llmLabel || llmModel || '—'}</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-400">{llmModel || '모델 정보를 불러오는 중…'}</p>
              <p className="mt-3 text-xs text-slate-500">
                문제 생성 · PDF 토픽 추론 · AI 튜터 스트리밍에 동일하게 적용됩니다. 서버 재시작 시 기본값으로 돌아갑니다.
              </p>
            </div>
            <div className="flex w-full flex-col justify-center gap-2 lg:max-w-sm">
              <label htmlFor="llm-select" className="text-xs font-medium uppercase tracking-wide text-slate-500">
                모델 변경
              </label>
              <select
                id="llm-select"
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none ring-accent focus:ring-2 disabled:opacity-50"
                value={llmModel}
                disabled={llmSaving || llmOptions.length === 0}
                onChange={(e) => handleLlmChange(e.target.value)}
              >
                {llmOptions.length === 0 ? (
                  <option value="">목록 없음</option>
                ) : (
                  llmOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))
                )}
              </select>
              {llmSaving ? <p className="text-xs text-slate-500">모델 적용 중…</p> : null}
              {llmContextErr && !llmSettingsErr ? <p className="text-xs text-rose-400">{llmContextErr}</p> : null}
              {llmSettingsErr ? <p className="text-xs text-rose-400">{llmSettingsErr}</p> : null}
            </div>
          </div>
        </PageCard>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 sm:gap-4">
        <ConnectionStatusCard title="DB 연결 상태" status={health?.dbStatus} fallbackText="DB 연결 점검 필요" />
        <ConnectionStatusCard title="LLM 연결 상태" status={health?.llmStatus} fallbackText="LLM 연결 점검 필요" />
        <PageCard className="p-4 sm:p-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">시스템 상태</h2>
          <p className="mt-2 text-lg font-semibold text-white">{health?.ok ? '정상 동작' : '확인 필요'}</p>
          <p className="mt-1 text-xs text-slate-400">
            {health?.db && health?.llm ? 'DB / LLM 연결 정상' : 'DB 또는 LLM 연결 점검 필요'}
          </p>
        </PageCard>
        <PageCard className="p-4 sm:p-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">학습 소스</h2>
          <p className="mt-2 text-lg font-semibold text-white">{files.length}개 파일</p>
          <p className="mt-1 text-xs text-slate-400">총 {totalChunks}개 청크 임베딩</p>
        </PageCard>
        <PageCard className="p-4 sm:p-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">시험 유형</h2>
          <p className="mt-2 text-lg font-semibold text-white">{examTypeCount}개 카테고리</p>
          <p className="mt-1 text-xs text-slate-400">{files.length > 0 ? '소스 기반 자동 분류' : '소스 업로드 필요'}</p>
        </PageCard>
        <PageCard className="p-4 sm:p-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">오답 노트</h2>
          <p className="mt-2 text-lg font-semibold text-white">{wrongItems.length}건 누적</p>
          <p className="mt-1 text-xs text-slate-400">{wrongRateLabel}</p>
        </PageCard>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <PageCard className="p-4 sm:p-5 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">최근 학습 소스</h2>
            <NavLink to="/upload" className="text-xs font-medium text-accent hover:underline">
              새 PDF 업로드
            </NavLink>
          </div>
          {filesErr ? <p className="mt-3 text-sm text-rose-400">{filesErr}</p> : null}
          {!filesErr && recentFiles.length === 0 ? <EmptyState text="아직 적재된 파일이 없습니다." className="mt-3 text-slate-400" /> : null}
          {recentFiles.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              {recentFiles.map((f) => (
                <li key={f.source} className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium text-white">{f.source}</p>
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{f.examType}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">청크 {f.chunkCount}개 · 최대 p.{f.maxPage || '-'}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </PageCard>

        <PageCard className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-white">빠른 시작</h2>
          <p className="mt-1 text-xs text-slate-400">오늘 학습 흐름을 바로 시작하세요.</p>
          <div className="mt-4 space-y-2">
            <NavLink to="/quiz" className="block rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white">
              문제 풀기 시작
            </NavLink>
            <NavLink to="/exam" className="block rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white">
              시험 시뮬레이션
            </NavLink>
            <NavLink to="/wrong" className="block rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white">
              오답 복습
            </NavLink>
          </div>
          {wrongErr ? <p className="mt-3 text-xs text-rose-400">{wrongErr}</p> : null}
        </PageCard>
      </div>

      {isLoading ? <p className="mt-4 text-xs text-slate-500">대시보드 데이터를 불러오는 중입니다…</p> : null}
    </PageContainer>
  );
}
