import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-6xl">🤔</p>
      <h1 className="mt-4 text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-slate-400">That page wandered offside.</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-lg bg-pitch-600 px-4 py-2 font-medium text-white hover:bg-pitch-700"
      >
        Back to schedule
      </Link>
    </div>
  );
}
