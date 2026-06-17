import type { ReactNode } from 'react';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-pitch-500" />
      {label}
    </div>
  );
}

export function ErrorState({ error }: { error: Error }) {
  return (
    <div className="card mx-auto my-12 max-w-lg p-6 text-center">
      <p className="text-lg font-semibold text-red-400">Couldn’t load data</p>
      <p className="mt-2 text-sm text-slate-400">{error.message}</p>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="card my-8 p-10 text-center text-slate-400">{message}</div>
  );
}
