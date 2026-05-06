import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

import {
  createProject,
  ensureUser,
  type CreateProjectInput,
} from "@/lib/db/repositories/projects";

export const runtime = "nodejs";

type RequestBody = {
  name: string;
  prd: unknown;
};

function parseBody(payload: unknown): RequestBody | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { name?: unknown; prd?: unknown };
  if (typeof body.name !== "string" || body.name.trim().length === 0) return null;
  if (!body.prd || typeof body.prd !== "object") return null;
  return { name: body.name.trim(), prd: body.prd };
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    `${userId}@unknown.invalid`;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const body = parseBody(payload);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  await ensureUser({ id: userId, email });

  const input: CreateProjectInput = {
    userId,
    name: body.name,
    prd: body.prd as CreateProjectInput["prd"],
  };
  const project = await createProject(input);
  return NextResponse.json({ id: project.id, slug: project.slug });
}
