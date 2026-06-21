import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getMatches, useData } from './data';
import { matchStatus } from './featured';
import { fetchLive, liveScoresEnabled, type LiveResponse } from './live';

// One poll for the whole page (banner + all match cards), shared via context.
// Only hits the network while a match is in a live window and the tab is
// visible — so it never spends the API budget when nothing is in play.
const POLL_MS = 60_000;

const LiveContext = createContext<LiveResponse | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const { data: matches } = useData(getMatches);
  const [live, setLive] = useState<LiveResponse | null>(null);

  useEffect(() => {
    if (!liveScoresEnabled) return;
    let stopped = false;

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const anyLive = (matches ?? []).some((m) => matchStatus(m) === 'live');
      if (!anyLive) {
        setLive(null);
        return;
      }
      const data = await fetchLive();
      if (!stopped && data) setLive(data);
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [matches]);

  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveResponse | null {
  return useContext(LiveContext);
}
