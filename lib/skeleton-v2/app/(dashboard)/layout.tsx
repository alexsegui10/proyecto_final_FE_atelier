/**
 * Dashboard layout — routes behind auth (Profile, Admin, etc.).
 * The Pages & Routing agent wraps this with DashboardLayout + AuthGuard
 * from `client/components/Layout/` and `client/components/Shared/`.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}
