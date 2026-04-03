import { NavLink, Route, Routes } from 'react-router-dom';
import { TopNav, LlmStatusPill } from './components/TopNav.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Upload from './pages/Upload.jsx';
import QuizMode from './pages/QuizMode.jsx';
import ExamMode from './pages/ExamMode.jsx';
import WrongNote from './pages/WrongNote.jsx';
import VectorDebug from './pages/VectorDebug.jsx';

const nav = [
  { to: '/', label: '대시보드', icon: 'dashboard' },
  { to: '/upload', label: 'PDF 업로드', icon: 'upload' },
  { to: '/quiz', label: '문제 풀기', icon: 'quiz' },
  { to: '/exam', label: '시험', icon: 'exam' },
  { to: '/wrong', label: '오답 노트', icon: 'wrong' },
  { to: '/vector-debug', label: '청크 뷰어', icon: 'search' },
];

function MenuIcon({ name }) {
  const paths = {
    dashboard: (
      <>
        <path d="M3.75 3.75h6.5v6.5h-6.5z" />
        <path d="M13.75 3.75h6.5v4.25h-6.5z" />
        <path d="M13.75 11.75h6.5v8.5h-6.5z" />
        <path d="M3.75 13.75h6.5v6.5h-6.5z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V5.5" />
        <path d="m8.5 9 3.5-3.5L15.5 9" />
        <path d="M5 16.75v1.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5" />
      </>
    ),
    quiz: (
      <>
        <path d="M8.25 8a3.75 3.75 0 1 1 6.2 2.82c-.8.72-1.45 1.29-1.45 2.43v.5" />
        <path d="M12 18.25h.01" />
        <path d="M4.75 12a7.25 7.25 0 1 0 14.5 0 7.25 7.25 0 0 0-14.5 0Z" />
      </>
    ),
    exam: (
      <>
        <path d="M7.25 4.75h9.5a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-9.5a2 2 0 0 1-2-2V6.75a2 2 0 0 1 2-2Z" />
        <path d="M9 9.5h6" />
        <path d="M9 12.5h6" />
        <path d="M9 15.5h4" />
      </>
    ),
    wrong: (
      <>
        <path d="M6.5 4.75h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
        <path d="m9 9 6 6" />
        <path d="m15 9-6 6" />
      </>
    ),
    search: (
      <>
        <path d="M11 4.75a6.25 6.25 0 1 1 0 12.5 6.25 6.25 0 0 1 0-12.5Z" />
        <path d="m19 19-3.4-3.4" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || null}
    </svg>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="flex min-h-screen w-full">
        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-slate-800/80 bg-slate-950/95 backdrop-blur md:block">
          <div className="flex h-full flex-col p-4">
            <div className="border-b border-slate-800/80 pb-4">
              <p className="text-xs font-medium uppercase tracking-widest text-accent">IT Cert</p>
              <h1 className="text-lg font-bold text-white">자격증 학습 플랫폼</h1>
              <p className="mt-1 text-xs text-slate-400">매일 20분, 합격까지 한 걸음</p>
            </div>

            <div className="mt-5">
              <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">학습 메뉴</p>
              <nav className="space-y-1">
                {nav.map(({ to, label, icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                        isActive
                          ? 'bg-accent/90 text-white shadow-[0_4px_18px_rgba(14,165,233,0.22)]'
                          : 'text-slate-300 hover:bg-slate-800/90 hover:text-white'
                      }`
                    }
                    title={label}
                  >
                    <span
                      aria-hidden
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900/50 text-base group-hover:bg-slate-900/80"
                    >
                      <MenuIcon name={icon} />
                    </span>
                    <span className="truncate">{label}</span>
                  </NavLink>
                ))}
              </nav>
            </div>

            <div className="mt-auto border-t border-slate-800/80 pt-4" />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-end border-b border-slate-800/80 bg-slate-950/95 px-3 py-2 backdrop-blur md:hidden">
            <LlmStatusPill />
          </div>
          <TopNav />
          <header className="border-b border-slate-800/80 bg-slate-950/90 px-4 py-3 backdrop-blur md:hidden">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">IT Cert</p>
            <h1 className="text-lg font-bold text-white">자격증 학습 플랫폼</h1>
            <nav className="mt-3 grid grid-cols-2 gap-2">
              {nav.map(({ to, label, icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                      isActive ? 'bg-accent text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`
                  }
                >
                  <span aria-hidden className="flex h-5 w-5 items-center justify-center text-slate-300">
                    <MenuIcon name={icon} />
                  </span>
                  <span className="truncate">{label}</span>
                </NavLink>
              ))}
            </nav>
          </header>

          <main className="min-w-0 flex-1 px-4 py-8 md:px-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/upload" element={<Upload />} />
              <Route path="/quiz" element={<QuizMode />} />
              <Route path="/exam" element={<ExamMode />} />
              <Route path="/wrong" element={<WrongNote />} />
              <Route path="/vector-debug" element={<VectorDebug />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}
