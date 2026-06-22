"use client";

import { useStats, useCharts, useRecentRequests } from "@/lib/hooks/use-dashboard-data";
import { StatCard } from "./stat-card";
import { RequestVolumeChart } from "./request-volume-chart";
import { LatencyChart } from "./latency-chart";
import { RecentRequestsTable } from "./recent-requests-table";

export function OverviewDashboard() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: charts, isLoading: chartsLoading } = useCharts();
  const { data: requests, isLoading: requestsLoading } = useRecentRequests();

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total Requests (24h)" value={statsLoading ? "..." : stats?.totalRequests?.toLocaleString() || "0"} />
        <StatCard title="Total Cost (24h)" value={statsLoading ? "..." : `$${stats?.totalCost?.toFixed(4) || "0.0000"}`} />
        <StatCard title="Cache Hit Rate (24h)" value={statsLoading ? "..." : `${stats?.cacheHitRate || 0}%`} />
        <StatCard title="Failover Rate (24h)" value={statsLoading ? "..." : `${stats?.failoverRate || 0}%`} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {chartsLoading ? (
          <div className="h-64 bg-zinc-900 border border-zinc-800 rounded-xl animate-pulse" />
        ) : (
          <RequestVolumeChart data={charts?.requestVolume || []} />
        )}
        
        {chartsLoading ? (
          <div className="h-64 bg-zinc-900 border border-zinc-800 rounded-xl animate-pulse" />
        ) : (
          <LatencyChart data={charts?.latency || []} />
        )}
      </div>

      {/* Table */}
      {requestsLoading ? (
        <div className="h-96 bg-zinc-900 border border-zinc-800 rounded-xl animate-pulse" />
      ) : (
        <RecentRequestsTable requests={requests || []} />
      )}
    </div>
  );
}
