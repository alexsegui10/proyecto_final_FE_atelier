/**
 * Public layout — pages accessible without auth (Home, AuthPage, NotFound).
 * The api-frontend agent fills in the actual <Layout /> wrapper from
 * src/components/Layout/Layout.tsx.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh">{children}</div>;
}
