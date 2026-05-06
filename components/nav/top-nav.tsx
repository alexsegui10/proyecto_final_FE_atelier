import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { IconPlus, IconWand } from "@tabler/icons-react";

export function TopNav() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-900/80 bg-zinc-950/80 px-6 backdrop-blur">
      <Link href="/discover" className="flex items-center gap-2 text-sm font-medium text-zinc-100">
        <IconWand size={18} className="text-zinc-400" />
        <span>Atelier</span>
      </Link>
      <div className="flex items-center gap-3">
        <Link
          href="/discover"
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
        >
          <IconPlus size={14} />
          New project
        </Link>
        <UserButton />
      </div>
    </header>
  );
}
