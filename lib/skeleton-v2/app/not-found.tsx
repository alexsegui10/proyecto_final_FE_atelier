import Link from "next/link";

/**
 * Placeholder 404. The Pages & Routing agent replaces this with a styled
 * page that uses the design system (illustration + back-to-home CTA).
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-muted-foreground text-sm tracking-widest uppercase">404</p>
      <h1 className="text-2xl font-semibold">Página no encontrada</h1>
      <p className="text-muted-foreground max-w-md">La página que buscás no existe o fue movida.</p>
      <Link
        href="/"
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
      >
        Volver al inicio
      </Link>
    </main>
  );
}
