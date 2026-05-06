/**
 * Dashboard layout — wrap any (dashboard)/* route with auth + chrome.
 * Auth & RBAC agent fills in the auth gating; API & Frontend agent fills in
 * the visual shell (top nav, sidebar, etc.).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}
