export interface Goal {
  name: string;
  minute: string;
}

export interface Score {
  ft: [number, number];
  ht?: [number, number];
  et?: [number, number]; // extra-time aggregate, knockout ties only
  p?: [number, number]; // penalty shoot-out, when a tie went to spot-kicks
}

export type Stage = 'group' | 'knockout';

export interface Match {
  id: number;
  num: number;
  round: string;
  stage: Stage;
  group: string | null;
  date: string; // YYYY-MM-DD
  kickoff: string | null; // ISO UTC
  localTime: string; // e.g. "13:00 UTC-6"
  offsetLabel: string | null;
  venue: string | null;
  team1: string;
  team2: string;
  team1Slug: string | null;
  team2Slug: string | null;
  team1Flag: string;
  team2Flag: string;
  finished: boolean;
  score: Score | null;
  goals1: Goal[];
  goals2: Goal[];
}

export interface Team {
  name: string;
  slug: string;
  flag: string;
  group: string | null;
}

export type Groups = Record<string, string[]>;

export interface StandingRow {
  team: string;
  slug: string;
  flag: string;
  rank: number;
  played: number;
  won: number;
  draw: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

export type Standings = Record<string, StandingRow[]>;

export interface BracketTie {
  num: number;
  date: string;
  kickoff: string | null;
  localTime: string;
  venue: string | null;
  team1: string;
  team2: string;
  team1Flag: string;
  team2Flag: string;
  team1Slug: string | null;
  team2Slug: string | null;
  finished: boolean;
  score: Score | null;
}

export type Bracket = Record<string, BracketTie[]>;

export interface Meta {
  lastFetchAt: string;
  lastUpdated: string;
  source: string;
  sourceName: string;
  counts: {
    matches: number;
    teams: number;
    groups: number;
    finished: number;
  };
}
