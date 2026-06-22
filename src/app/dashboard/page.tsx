import { OverviewDashboard } from "@/components/dashboard/overview-dashboard";

export const metadata = {
  title: "Overview | AuraGate Admin",
};

export default function DashboardPage() {
  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-zinc-100">Overview</h2>
        <p className="text-zinc-400 mt-1">Real-time system telemetry and performance</p>
      </div>
      <OverviewDashboard />
    </>
  );
}
