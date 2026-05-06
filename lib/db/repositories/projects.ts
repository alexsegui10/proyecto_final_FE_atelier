import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";

export type CreateProjectInput = {
  userId: string;
  name: string;
  prd: Prisma.InputJsonValue;
};

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : suffix;
}

export async function ensureUser(params: { id: string; email: string }) {
  return prisma.user.upsert({
    where: { id: params.id },
    update: { email: params.email },
    create: { id: params.id, email: params.email },
  });
}

export async function createProject(input: CreateProjectInput) {
  return prisma.project.create({
    data: {
      slug: slugify(input.name),
      userId: input.userId,
      name: input.name,
      prd: input.prd,
    },
  });
}

export async function getProjectById(id: string) {
  return prisma.project.findUnique({ where: { id } });
}

export async function listProjectsByUser(userId: string) {
  return prisma.project.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}
