export default function QuestionCard({ question, options, selected, onSelect, disabled }) {
  const list = Array.isArray(options) ? options : [];

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-900/50 p-5 shadow-lg">
      <p className="text-base font-medium leading-relaxed text-slate-100">{question}</p>
      <ul className="mt-4 space-y-2">
        {list.map((opt, i) => {
          const active = selected === i;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(i)}
                className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition ${
                  active
                    ? 'border-accent bg-accent/15 text-white'
                    : 'border-slate-600 bg-slate-950/60 text-slate-300 hover:border-slate-500'
                } ${disabled ? 'cursor-default opacity-80' : ''}`}
              >
                {opt}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
