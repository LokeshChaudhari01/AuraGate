import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useStats() {
  return useSWR("/api/admin/stats", fetcher, { refreshInterval: 5000 });
}

export function useCharts() {
  return useSWR("/api/admin/charts", fetcher, { refreshInterval: 5000 });
}

export function useRecentRequests() {
  return useSWR("/api/admin/requests", fetcher, { refreshInterval: 5000 });
}

export function useAnalytics() {
  return useSWR("/api/admin/analytics", fetcher, { refreshInterval: 10000 });
}

export function useTenants() {
  return useSWR("/api/admin/tenants", fetcher);
}

export function useKeys() {
  return useSWR("/api/admin/keys", fetcher);
}
