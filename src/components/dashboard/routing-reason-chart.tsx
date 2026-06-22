"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export function RoutingReasonChart({ data }: { data: any[] }) {
  if (!data || data.length === 0) return <div className="h-64 flex items-center justify-center text-zinc-500">No data</div>;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <h3 className="text-lg font-medium text-zinc-100 mb-4">Routing Reason Breakdown</h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 10, right: 10, left: 40, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
            <XAxis type="number" stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis dataKey="reason" type="category" stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} width={100} />
            <Tooltip
              contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "8px" }}
              itemStyle={{ color: "#f4f4f5" }}
              formatter={(value) => [value, "Requests"]}
            />
            <Bar dataKey="count" fill="#14b8a6" radius={[0, 4, 4, 0]} barSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
