export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <div className="h-8 w-52 animate-pulse rounded bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            className="h-28 animate-pulse rounded-lg border border-slate-200 bg-white"
            key={index}
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-white" />
    </div>
  );
}
