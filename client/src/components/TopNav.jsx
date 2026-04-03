import { useLlmStatus } from '../context/LlmStatusContext.jsx';

export function LlmStatusPill({ className = '' }) {
  const { model, apiModel, provider, label, llmOk, llmState, loading } = useLlmStatus();
  const display = label || apiModel || model || (loading ? '불러오는 중…' : '—');

  let showPing = false;
  let dotClass = 'bg-slate-500';
  let borderClass = 'border-slate-700/90';
  let pingMs = '1.5s';

  if (loading) {
    dotClass = 'bg-slate-400';
  } else if (llmOk && llmState === 'connected') {
    showPing = true;
    dotClass = 'bg-emerald-400';
    borderClass = 'border-emerald-500/35';
    pingMs = '1.6s';
  } else if (llmOk && llmState === 'degraded') {
    showPing = true;
    dotClass = 'bg-amber-400';
    borderClass = 'border-amber-500/35';
    pingMs = '1s';
  } else {
    dotClass = 'bg-rose-500';
    borderClass = 'border-rose-500/30';
  }

  return (
    <div
      className={`flex max-w-[min(100%,90vw,420px)] items-center gap-2 rounded-full border bg-slate-900/85 py-1.5 pl-2.5 pr-3 shadow-sm shadow-black/20 ${borderClass} ${className}`}
      title={apiModel ? `${provider} → ${apiModel}` : model || undefined}
    >
      <span className="relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center">
        {showPing ? (
          <>
            <span
              className={`absolute inline-flex h-2.5 w-2.5 rounded-full opacity-50 ${dotClass} animate-ping`}
              style={{ animationDuration: pingMs }}
            />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotClass}`} />
          </>
        ) : (
          <span
            className={`inline-flex h-2.5 w-2.5 rounded-full ${dotClass} ${loading || !llmOk ? 'animate-pulse' : ''}`}
          />
        )}
      </span>
      <p className="min-w-0 truncate whitespace-nowrap text-xs leading-none">
        <span className="font-medium text-slate-500">LLM</span>
        <span className="px-1.5 text-slate-600">·</span>
        <span className="font-medium text-white">{display}</span>
      </p>
    </div>
  );
}

export function TopNav() {
  return (
    <header className="sticky top-0 z-20 hidden h-12 shrink-0 items-center justify-end border-b border-slate-800/80 bg-slate-950/90 px-6 backdrop-blur md:flex">
      <LlmStatusPill />
    </header>
  );
}
