"use client";

import { useState } from "react";
import { useKeys, useTenants } from "@/lib/hooks/use-dashboard-data";

export function KeyManager() {
  const { data: keys, mutate: mutateKeys, isLoading: keysLoading } = useKeys();
  const { data: tenants, isLoading: tenantsLoading } = useTenants();
  
  const [tenantId, setTenantId] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !description) return;

    setCreating(true);
    setNewKey(null);
    try {
      const res = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, description }),
      });
      const data = await res.json();
      setNewKey(data.rawKey);
      setDescription("");
      mutateKeys();
    } catch (err) {
      console.error("Failed to create key", err);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Are you sure you want to revoke this API key?")) return;
    try {
      await fetch("/api/admin/keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      mutateKeys();
    } catch (err) {
      console.error("Failed to revoke key", err);
    }
  };

  if (keysLoading || tenantsLoading) {
    return <div className="animate-pulse h-64 bg-zinc-900 rounded-xl"></div>;
  }

  return (
    <div className="space-y-6">
      {newKey && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-6 rounded-xl">
          <h3 className="text-lg font-medium mb-2">API Key Created Successfully</h3>
          <p className="mb-4">Please copy this key now. You won't be able to see it again.</p>
          <div className="bg-zinc-950 p-4 rounded-lg font-mono text-sm break-all select-all">
            {newKey}
          </div>
          <button 
            onClick={() => setNewKey(null)}
            className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700"
          >
            I have copied the key
          </button>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h3 className="text-lg font-medium text-zinc-100 mb-4">Create New API Key</h3>
        <form onSubmit={handleCreate} className="flex gap-4">
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="w-48 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-100"
          >
            <option value="">Select Tenant...</option>
            {tenants?.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Key Description (e.g. Production Web App)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-100"
          />
          <button
            type="submit"
            disabled={creating || !tenantId || !description}
            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Generating..." : "Generate Key"}
          </button>
        </form>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800">
          <h3 className="text-lg font-medium text-zinc-100">API Keys</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-zinc-400">
            <thead className="text-xs text-zinc-500 uppercase bg-zinc-950/50">
              <tr>
                <th className="px-6 py-3">Tenant</th>
                <th className="px-6 py-3">Description</th>
                <th className="px-6 py-3">Key Hash (Truncated)</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Created</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys?.map((k: any) => (
                <tr key={k.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-zinc-200">{k.tenantName}</td>
                  <td className="px-6 py-4">{k.description}</td>
                  <td className="px-6 py-4 font-mono text-xs">{k.keyHash.substring(0, 12)}...</td>
                  <td className="px-6 py-4">
                    {k.isActive ? (
                      <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded text-xs">Active</span>
                    ) : (
                      <span className="px-2 py-1 bg-red-500/10 text-red-400 rounded text-xs">Revoked</span>
                    )}
                  </td>
                  <td className="px-6 py-4">{new Date(k.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4">
                    {k.isActive && (
                      <button
                        onClick={() => handleRevoke(k.id)}
                        className="text-orange-400 hover:text-orange-300 font-medium"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
