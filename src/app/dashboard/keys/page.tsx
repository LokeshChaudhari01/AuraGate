import { KeyManager } from "@/components/dashboard/key-manager";

export const metadata = {
  title: "API Keys | AuraGate Admin",
};

export default function KeysPage() {
  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-zinc-100">API Key Management</h2>
        <p className="text-zinc-400 mt-1">Generate and revoke API keys for tenant access</p>
      </div>
      <KeyManager />
    </>
  );
}
