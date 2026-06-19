import { NavLink, Route, Routes } from 'react-router-dom';
import TzSelect from './components/TzSelect';
import { useData, getMeta } from './lib/data';
import Schedule from './routes/Schedule';
import Results from './routes/Results';
import Standings from './routes/Standings';
import BracketPage from './routes/BracketPage';
import Team from './routes/Team';
import NotFound from './routes/NotFound';

const NAV = [
  { to: '/', label: 'Schedule', end: true },
  { to: '/results', label: 'Results', end: false },
  { to: '/standings', label: 'Standings', end: false },
  { to: '/bracket', label: 'Bracket', end: false },
];

function Footer() {
  const { data: meta } = useData(getMeta);
  return (
    <footer className="mt-16 border-t border-slate-800 py-8 text-center text-xs text-slate-500">
      {meta && (
        <p>
          Data updated{' '}
          {new Date(meta.lastUpdated).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
            hour12: true,
          })}{' '}
          · {meta.counts.finished}/{meta.counts.matches} matches played
        </p>
      )}
      <p className="mt-1">
        Source:{' '}
        <a
          href="https://github.com/upbound-web/worldcup-live.json"
          className="underline hover:text-slate-300"
          target="_blank"
          rel="noreferrer"
        >
          upbound-web/worldcup-live.json
        </a>
        . Unofficial fan site.
      </p>
    </footer>
  );
}

export default function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4">
      <header className="sticky top-0 z-10 -mx-4 border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <NavLink to="/" className="flex items-center gap-2 font-extrabold tracking-tight">
            <span className="text-xl">🏆</span>
            <span className="hidden sm:inline">World Cup 2026</span>
          </NavLink>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `nav-link ${isActive ? 'nav-link-active' : ''}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <TzSelect />
        </div>
      </header>

      <main className="flex-1 py-6">
        <Routes>
          <Route path="/" element={<Schedule />} />
          <Route path="/results" element={<Results />} />
          <Route path="/standings" element={<Standings />} />
          <Route path="/bracket" element={<BracketPage />} />
          <Route path="/team/:slug" element={<Team />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <Footer />
    </div>
  );
}
