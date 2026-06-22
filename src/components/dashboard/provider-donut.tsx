"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

const COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981"];

export function ProviderDonut({ data, dataKey = "requests" }: { data: any[], dataKey?: string }) {
  if (!data || data.length === 0) return <div className="h-64 flex items-center justify-center text-zinc-500">No data</div>;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <h3 className="text-lg font-medium text-zinc-100 mb-4">
        {dataKey === "requests" ? "Requests by Provider" : "Cost by Provider"}
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
              nameKey="provider"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
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
