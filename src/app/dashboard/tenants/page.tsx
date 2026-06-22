import { TenantManager } from "@/components/dashboard/tenant-manager";

export const metadata = {
  title: "Tenants | AuraGate Admin",
};

export default function TenantsPage() {
  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-zinc-100">Tenant Management</h2>
        <p className="text-zinc-400 mt-1">Manage tenant accounts, budgets, and billing limits</p>
      </div>
      <TenantManager />
    </>
  );
}
