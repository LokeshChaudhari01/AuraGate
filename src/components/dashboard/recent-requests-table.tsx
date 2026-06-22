export function RecentRequestsTable({ requests }: { requests: any[] }) {
  if (!requests || requests.length === 0) {
    return <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center text-zinc-500">No recent requests</div>;
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800">
        <h3 className="text-lg font-medium text-zinc-100">Recent Requests</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-zinc-400">
          <thead className="text-xs text-zinc-500 uppercase bg-zinc-950/50">
            <tr>
              <th className="px-6 py-3">Time</th>
              <th className="px-6 py-3">Tenant</th>
              <th className="px-6 py-3">Model</th>
              <th className="px-6 py-3">Type</th>
              <th className="px-6 py-3">Tokens</th>
              <th className="px-6 py-3">Cost (USD)</th>
              <th className="px-6 py-3">Latency</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(requests) ? requests : []).map((req) => (
              <tr key={req.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">{new Date(req.time).toLocaleTimeString()}</td>
                <td className="px-6 py-4">{req.tenantName || req.tenantId?.substring(0,8)}</td>
                <td className="px-6 py-4">
                  <span className="bg-zinc-800 px-2 py-1 rounded text-zinc-300">{req.model}</span>
                </td>
                <td className="px-6 py-4">
                  {req.queryType && (
                    <span className={`px-2 py-1 rounded text-xs ${
                      req.queryType === 'coding' ? 'bg-blue-500/10 text-blue-400' :
                      req.queryType === 'complex' ? 'bg-purple-500/10 text-purple-400' :
                      'bg-emerald-500/10 text-emerald-400'
                    }`}>
                      {req.queryType}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">{req.promptTokens + req.completionTokens}</td>
                <td className="px-6 py-4 font-mono">${Number(req.costUsd).toFixed(4)}</td>
                <td className="px-6 py-4">{req.latencyMs}ms</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded text-xs ${
                    req.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' :
                    req.status === 'CACHED' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-red-500/10 text-red-400'
                  }`}>
                    {req.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
