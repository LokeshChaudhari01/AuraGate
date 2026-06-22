"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export function ModelBarChart({ data, dataKey = "requests", fill = "#8b5cf6" }: { data: any[], dataKey?: string, fill?: string }) {
  if (!data || data.length === 0) return <div className="h-64 flex items-center justify-center text-zinc-500">No data</div>;

  const titles: Record<string, string> = {
    requests: "Requests by Model",
    avgLatency: "Avg Latency by Model (ms)",
    successRate: "Success Rate by Model (%)",
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <h3 className="text-lg font-medium text-zinc-100 mb-4">{titles[dataKey] || dataKey}</h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="model" stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} angle={-15} textAnchor="end" />
            <YAxis stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "8px" }}
              itemStyle={{ color: "#f4f4f5" }}
              formatter={(value) => {
                if (dataKey === "avgLatency") return [`${Math.round(Number(value))} ms`, "Latency"];
                if (dataKey === "successRate") return [`${Number(value).toFixed(1)}%`, "Success Rate"];
                return [value, "Requests"];
              }}
            />
            <Bar dataKey={dataKey} fill={fill} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
