import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { TopNav } from "@/components/nav/top-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <TopNav />
      <div className="flex-1">{children}</div>
    </div>
  );
}
