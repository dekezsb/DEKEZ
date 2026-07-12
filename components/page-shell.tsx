type PageShellProps = {
  title: string;
  description: string;
};

export function PageShell({ title, description }: PageShellProps) {
  return (
    <section className="w-full">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-normal text-[#126b5f]">
          Workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-gray-950 sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
          {description}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Status</p>
          <p className="mt-2 text-lg font-semibold text-gray-950">Ready</p>
        </div>
        <div className="rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Data Source</p>
          <p className="mt-2 text-lg font-semibold text-gray-950">Supabase</p>
        </div>
        <div className="rounded-lg border border-[#d7dde5] bg-white p-5 shadow-sm sm:col-span-2 xl:col-span-1">
          <p className="text-sm font-medium text-gray-500">Next Step</p>
          <p className="mt-2 text-lg font-semibold text-gray-950">Build module</p>
        </div>
      </div>
    </section>
  );
}
