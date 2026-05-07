/**
 * Dashboard layout — pages behind auth (Profile, Admin pages).
 * api-frontend agent wraps with <DashboardLayout /> + <AuthGuard />.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh flex flex-col">{children}</div>;
}
