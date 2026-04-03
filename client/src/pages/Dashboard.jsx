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
  const {
    model: llmModel,
    apiModel: llmApiModel,
    label: llmLabel,
    provider: llmProvider,
    options: llmOptions,
    keyStatus,
    keyHints,
    error: llmContextErr,
    refresh: refreshLlm,
  } = useLlmStatus();
  const [health, setHealth] = useState(null);
  const [files, setFiles] = useState([]);
  const [wrongItems, setWrongItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filesErr, setFilesErr] = useState('');
  const [wrongErr, setWrongErr] = useState('');
  const [llmSettingsErr, setLlmSettingsErr] = useState('');
  const [llmSaving, setLlmSaving] = useState(false);
  const [providerKeyDraft, setProviderKeyDraft] = useState('');
  const [keySaving, setKeySaving] = useState(false);
  const [keyErr, setKeyErr] = useState('');

  const ollamaOptions = useMemo(() => llmOptions.filter((o) => o.provider === 'ollama'), [llmOptions]);
  const openaiOptions = useMemo(() => llmOptions.filter((o) => o.provider === 'openai'), [llmOptions]);
  const geminiOptions = useMemo(() => llmOptions.filter((o) => o.provider === 'gemini'), [llmOptions]);
  const claudeOptions = useMemo(() => llmOptions.filter((o) => o.provider === 'claude'), [llmOptions]);

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
    setKeyErr('');
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

  const needsProviderKey = llmProvider === 'openai' || llmProvider === 'gemini' || llmProvider === 'claude';
  const providerHasKey = Boolean(keyStatus?.[llmProvider]);
  const providerKeyHint = keyHints?.[llmProvider] || null;

  async function handleSaveProviderKey() {
    setKeySaving(true);
    setKeyErr('');
    try {
      const res = await fetch(`${apiBase}/api/settings/llm`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyProvider: llmProvider, providerApiKey: providerKeyDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setKeyErr(data.error || 'API 키 저장에 실패했습니다.');
        return;
      }
      setProviderKeyDraft('');
      await refreshLlm();
      const healthRes = await fetch(`${apiBase}/api/health`).then((r) => r.json());
      setHealth(healthRes);
    } catch {
      setKeyErr('API 키 저장 중 오류가 났습니다.');
    } finally {
      setKeySaving(false);
    }
  }

  async function handleClearProviderKey() {
    setKeySaving(true);
    setKeyErr('');
    try {
      const res = await fetch(`${apiBase}/api/settings/llm`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyProvider: llmProvider, providerApiKey: '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setKeyErr(data.error || '초기화에 실패했습니다.');
        return;
      }
      await refreshLlm();
      const healthRes = await fetch(`${apiBase}/api/health`).then((r) => r.json());
      setHealth(healthRes);
    } catch {
      setKeyErr('초기화 중 오류가 났습니다.');
    } finally {
      setKeySaving(false);
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
              <p className="mt-2 truncate text-xl font-semibold text-white">{llmLabel || llmApiModel || '—'}</p>
              <p className="mt-1 text-xs text-slate-500">
                백엔드: <span className="font-mono text-slate-400">{llmProvider || '—'}</span>
                {llmApiModel ? (
                  <>
                    {' '}
                    · API 모델 <span className="font-mono text-slate-400">{llmApiModel}</span>
                  </>
                ) : null}
              </p>
              <p className="mt-1 break-all font-mono text-[11px] text-slate-500">옵션 ID: {llmModel || '—'}</p>
              <p className="mt-3 text-xs text-slate-500">
                문제 생성 · PDF 토픽 추론 · AI 튜터에 동일하게 적용됩니다. 임베딩은 항상 Ollama{' '}
                <span className="font-mono text-slate-400">nomic-embed-text</span>입니다. 선택·API 키는 서버 메모리에만
                있으며 재시작 시 초기화됩니다.
              </p>
            </div>
            <div className="flex w-full flex-col justify-center gap-3 lg:max-w-md">
              <div>
                <label htmlFor="llm-select" className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  모델 변경
                </label>
                <select
                  id="llm-select"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none ring-accent focus:ring-2 disabled:opacity-50"
                  value={llmModel}
                  disabled={llmSaving || llmOptions.length === 0}
                  onChange={(e) => handleLlmChange(e.target.value)}
                >
                  {llmOptions.length === 0 ? (
                    <option value="">목록 없음</option>
                  ) : (
                    <>
                      {ollamaOptions.length > 0 ? (
                        <optgroup label="Ollama (로컬)">
                          {ollamaOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {openaiOptions.length > 0 ? (
                        <optgroup label="OpenAI (API 키)">
                          {openaiOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {geminiOptions.length > 0 ? (
                        <optgroup label="Gemini (API 키)">
                          {geminiOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {claudeOptions.length > 0 ? (
                        <optgroup label="Claude (API 키)">
                          {claudeOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </>
                  )}
                </select>
                {llmSaving ? <p className="mt-1 text-xs text-slate-500">모델 적용 중…</p> : null}
              </div>

              {needsProviderKey ? (
                <div className="rounded-xl border border-slate-700/80 bg-slate-950/40 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{llmProvider.toUpperCase()} API 키</p>
                  <p className="mt-1 text-xs text-slate-500">
                    키는 이 Node 프로세스 메모리에만 저장되며 응답 본문으로는 전체 값이 내려가지 않습니다.
                    {providerHasKey ? (
                      <span className="block pt-1 text-emerald-400/90">저장됨 {providerKeyHint ? `(${providerKeyHint})` : ''}</span>
                    ) : (
                      <span className="block pt-1 text-amber-400/90">키가 없으면 채팅/생성 요청이 실패합니다.</span>
                    )}
                  </p>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="sk-..."
                    value={providerKeyDraft}
                    onChange={(e) => setProviderKeyDraft(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-sm text-white outline-none ring-accent placeholder:text-slate-600 focus:ring-2"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={keySaving}
                      onClick={handleSaveProviderKey}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {keySaving ? '저장 중…' : '키 저장'}
                    </button>
                    <button
                      type="button"
                      disabled={keySaving || !providerHasKey}
                      onClick={handleClearProviderKey}
                      className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                    >
                      키 지우기
                    </button>
                  </div>
                  {keyErr ? <p className="mt-2 text-xs text-rose-400">{keyErr}</p> : null}
                </div>
              ) : null}

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
