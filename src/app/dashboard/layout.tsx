"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.push("/admin-login");
  };

  const navItems = [
    { name: "Overview", path: "/dashboard" },
    { name: "Routing Analytics", path: "/dashboard/analytics" },
    { name: "Tenants", path: "/dashboard/tenants" },
    { name: "API Keys", path: "/dashboard/keys" },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex">
      {/* Sidebar */}
      <div className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col fixed h-full">
        <div className="p-6 border-b border-zinc-800">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            AuraGate
          </h1>
          <p className="text-xs text-zinc-500 mt-1">Admin Dashboard</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.path;
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`block px-4 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white font-medium"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-zinc-800">
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors text-left"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="ml-64 flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
