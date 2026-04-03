export default function WeaknessChart({ rows }) {
  if (!rows?.length) return <p className="text-sm text-slate-500">채점 후 토픽별 정답률이 표시됩니다.</p>;

  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.topic} className="flex items-center gap-3">
          <div className="w-28 shrink-0 truncate text-xs text-slate-400" title={r.topic}>
            {r.topic || '(미분류)'}
          </div>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full ${r.rate < 50 ? 'bg-rose-500' : r.rate < 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${r.rate}%` }}
            />
          </div>
          <span className="w-12 text-right text-xs tabular-nums text-slate-300">{r.rate}%</span>
        </li>
      ))}
    </ul>
  );
}
