export function PageContainer({ children }) {
  return <section className="mx-auto w-full max-w-6xl">{children}</section>;
}

export function PageHeader({ title, description, action }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-slate-800/80 pb-4 sm:mb-6">
      <div>
        <h1 className="text-xl font-bold text-white sm:text-2xl">{title}</h1>
        {description ? <p className="mt-2 text-sm text-slate-400">{description}</p> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function PageCard({ children, className = '' }) {
  return <div className={`rounded-2xl border border-slate-700/80 bg-slate-900/45 p-4 ${className}`}>{children}</div>;
}

export function EmptyState({ text, className = '' }) {
  return <p className={`text-sm text-slate-500 ${className}`}>{text}</p>;
}
