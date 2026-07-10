export default function Home() {
  return (
    <section className="w-full">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-normal text-[#126b5f]">
          Setup complete
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-normal text-gray-950 sm:text-5xl">
          DEKEZ Rental Management System
        </h1>
        <p className="mt-5 text-lg text-gray-600">System setup successful.</p>
        <button className="mt-8 rounded-md bg-[#126b5f] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0f5a50] focus:outline-none focus:ring-2 focus:ring-[#126b5f] focus:ring-offset-2">
          Admin Login
        </button>
      </div>
    </section>
  );
}
