type PageShellProps = {
  title: string;
  description: string;
};

export function PageShell({ title, description }: PageShellProps) {
  return (
    <section className="w-full">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-normal text-[#126b5f]">
          DEKEZ
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-normal text-gray-950">
          {title}
        </h1>
        <p className="mt-4 text-base text-gray-600">{description}</p>
      </div>
    </section>
  );
}
