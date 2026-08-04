import { ElectricityTopUpPilot } from "@/components/smart-meter/electricity-top-up-pilot";

export const metadata = {
  title: "Tenant Electricity Top-Up Preview | DEKEZ",
};

export default function BdsElectricityTopUpPreviewPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 py-4 sm:py-8">
      <div className="rounded-xl border border-violet-200 bg-violet-50 px-5 py-4">
        <p className="text-xs font-bold uppercase tracking-wide text-violet-700">
          Safe design preview
        </p>
        <h1 className="mt-1 text-2xl font-bold text-gray-950 sm:text-3xl">
          Tenant Electricity Top-Up
        </h1>
        <p className="mt-2 text-sm leading-6 text-violet-900">
          This all-property preview uses sample room data and does not connect to
          tenant records, accept payment or change a smart-meter balance.
        </p>
      </div>

      <ElectricityTopUpPilot
        adminPreview
        propertyName="BDS - BUNDUSAN"
        roomName="Example Room"
      />
    </main>
  );
}
