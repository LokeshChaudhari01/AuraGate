export function StatCard({
  title,
  value,
}: {
  title: string;
  value: string | number;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm">
      <h3 className="text-sm font-medium text-zinc-400 mb-2">{title}</h3>
      <div className="text-3xl font-semibold text-zinc-100">{value}</div>
    </div>
  );
}
