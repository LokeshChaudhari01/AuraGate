"use client";

import { useState } from "react";
import { useTenants } from "@/lib/hooks/use-dashboard-data";

export function TenantManager() {
  const { data: tenants, mutate, isLoading } = useTenants();
  const [name, setName] = useState("");
  const [budgetUsd, setBudgetUsd] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !budgetUsd) return;

    setCreating(true);
    try {
      await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, budgetUsd }),
      });
      setName("");
      setBudgetUsd("");
      mutate();
    } catch (err) {
      console.error("Failed to create tenant", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this tenant?")) return;
    try {
      await fetch("/api/admin/tenants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      mutate();
    } catch (err) {
      console.error("Failed to delete tenant", err);
    }
  };

  if (isLoading) {
    return <div className="animate-pulse h-64 bg-zinc-900 rounded-xl"></div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h3 className="text-lg font-medium text-zinc-100 mb-4">Create New Tenant</h3>
        <form onSubmit={handleCreate} className="flex gap-4">
          <input
            type="text"
            placeholder="Tenant Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-100"
          />
          <input
            type="number"
            step="0.01"
            placeholder="Budget (USD)"
            value={budgetUsd}
            onChange={(e) => setBudgetUsd(e.target.value)}
            className="w-48 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-zinc-100"
          />
          <button
            type="submit"
            disabled={creating || !name || !budgetUsd}
            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </form>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800">
          <h3 className="text-lg font-medium text-zinc-100">All Tenants</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-zinc-400">
            <thead className="text-xs text-zinc-500 uppercase bg-zinc-950/50">
              <tr>
                <th className="px-6 py-3">ID</th>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Budget (USD)</th>
                <th className="px-6 py-3">API Keys</th>
                <th className="px-6 py-3">Created</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants?.map((t: any) => (
                <tr key={t.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4 font-mono text-xs">{t.id}</td>
                  <td className="px-6 py-4 font-medium text-zinc-200">{t.name}</td>
                  <td className="px-6 py-4">${Number(t.budgetUsd).toFixed(2)}</td>
                  <td className="px-6 py-4">{t.keyCount}</td>
                  <td className="px-6 py-4">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="text-red-400 hover:text-red-300 font-medium"
                    >
                      Delete
                    </button>
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
