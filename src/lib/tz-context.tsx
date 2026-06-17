import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { loadTz, saveTz } from './time';

interface TzContextValue {
  tz: string;
  setTz: (tz: string) => void;
}

const TzContext = createContext<TzContextValue | null>(null);

export function TzProvider({ children }: { children: ReactNode }) {
  const [tz, setTzState] = useState<string>(() => loadTz());
  const setTz = useCallback((next: string) => {
    setTzState(next);
    saveTz(next);
  }, []);
  const value = useMemo(() => ({ tz, setTz }), [tz, setTz]);
  return <TzContext.Provider value={value}>{children}</TzContext.Provider>;
}

export function useTz(): TzContextValue {
  const ctx = useContext(TzContext);
  if (!ctx) throw new Error('useTz must be used within TzProvider');
  return ctx;
}
