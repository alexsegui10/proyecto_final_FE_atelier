/**
 * Public layout — routes accessible without auth (Home, sign-in, sign-up).
 * The Pages & Routing agent wraps this with the public Header/Footer from
 * `client/components/Layout/`.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh">{children}</div>;
}
