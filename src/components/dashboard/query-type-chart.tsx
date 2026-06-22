"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

const COLORS: Record<string, string> = {
  simple: "#10b981",  // emerald
  coding: "#3b82f6",  // blue
  complex: "#8b5cf6", // purple
  unknown: "#6b7280", // gray
};

export function QueryTypeChart({ data, dataKey = "requests" }: { data: any[], dataKey?: string }) {
  if (!data || data.length === 0) return <div className="h-64 flex items-center justify-center text-zinc-500">No data</div>;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <h3 className="text-lg font-medium text-zinc-100 mb-4">
        {dataKey === "requests" ? "Requests by Query Type" : "Cost by Query Type"}
      </h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey={dataKey}
              nameKey="queryType"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[entry.queryType] || COLORS.unknown} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "8px" }}
              itemStyle={{ color: "#f4f4f5" }}
              formatter={(value) => dataKey === "totalCost" ? `$${Number(value).toFixed(4)}` : value}
            />
            <Legend verticalAlign="bottom" height={36} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
