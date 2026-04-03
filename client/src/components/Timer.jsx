export default function Timer({ label, value, urgent }) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-sm ${
        urgent ? 'border-amber-500/50 bg-amber-500/10 text-amber-200' : 'border-slate-600 bg-slate-900/80 text-slate-200'
      }`}
    >
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
