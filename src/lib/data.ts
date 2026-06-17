import { useEffect, useState } from 'react';
import type { Bracket, Groups, Match, Meta, Standings, Team } from '../types';

const cache = new Map<string, Promise<unknown>>();

function load<T>(file: string): Promise<T> {
  const url = `${import.meta.env.BASE_URL}data/${file}`;
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${file}: ${r.status}`);
      return r.json() as Promise<T>;
    });
    cache.set(url, p);
  }
  return p;
}

export const getMatches = () => load<Match[]>('matches.json');
export const getTeams = () => load<Team[]>('teams.json');
export const getGroups = () => load<Groups>('groups.json');
export const getStandings = () => load<Standings>('standings.json');
export const getBracket = () => load<Bracket>('bracket.json');
export const getMeta = () => load<Meta>('meta.json');

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/** Tiny hook for loading one of the static JSON resources. */
export function useData<T>(loader: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    loader()
      .then((data) => active && setState({ data, loading: false, error: null }))
      .catch((error: Error) => active && setState({ data: null, loading: false, error }));
    return () => {
      active = false;
    };
    // loaders are stable module-level fns; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
