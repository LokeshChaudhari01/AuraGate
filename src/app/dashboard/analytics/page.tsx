import { AnalyticsDashboard } from "@/components/dashboard/analytics-dashboard";

export const metadata = {
  title: "Routing Analytics | AuraGate Admin",
};

export default function AnalyticsPage() {
  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-zinc-100">Routing Intelligence</h2>
        <p className="text-zinc-400 mt-1">Multi-model routing distribution and complexity analysis</p>
      </div>
      <AnalyticsDashboard />
    </>
  );
}
