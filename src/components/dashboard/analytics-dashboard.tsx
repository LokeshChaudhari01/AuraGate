"use client";

import { useAnalytics } from "@/lib/hooks/use-dashboard-data";
import { ProviderDonut } from "./provider-donut";
import { ModelBarChart } from "./model-bar-chart";
import { QueryTypeChart } from "./query-type-chart";
import { ComplexityHistogram } from "./complexity-histogram";
import { RoutingReasonChart } from "./routing-reason-chart";

export function AnalyticsDashboard() {
  const { data, isLoading } = useAnalytics();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-64 bg-zinc-900 border border-zinc-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Row 1: Provider Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ProviderDonut data={data?.byProvider || []} dataKey="requests" />
        <ProviderDonut data={data?.byProvider || []} dataKey="totalCost" />
      </div>

      {/* Row 2: Model Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ModelBarChart data={data?.byModel || []} dataKey="requests" fill="#3b82f6" />
        <ModelBarChart data={data?.byModel || []} dataKey="avgLatency" fill="#8b5cf6" />
        <ModelBarChart data={data?.byModel || []} dataKey="successRate" fill="#10b981" />
      </div>

      {/* Row 3: Query Type Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <QueryTypeChart data={data?.byQueryType || []} dataKey="requests" />
        <QueryTypeChart data={data?.byQueryType || []} dataKey="totalCost" />
        <ModelBarChart data={data?.byQueryType || []} dataKey="successRate" fill="#f59e0b" />
      </div>

      {/* Row 4: Routing Intelligence */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ComplexityHistogram data={data?.complexityBuckets || []} />
        <RoutingReasonChart data={data?.routingReasons || []} />
      </div>
    </div>
  );
}
