import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".atelier",
  "out",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
  "generated",
]);

const TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "json", "md", "css", "html", "txt",
  "prisma", "yaml", "yml", "toml",
  "config", "env", "example", "template",
  "gitignore", "gitkeep", "lock",
]);

function isTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  const lastDot = lower.lastIndexOf(".");
  if (lastDot === -1) {
    const base = lower.split(/[\\/]/).pop() ?? "";
    return TEXT_EXTENSIONS.has(base) || base.startsWith(".env");
  }
  const ext = lower.slice(lastDot + 1);
  return TEXT_EXTENSIONS.has(ext);
}

type FileNode = {
  type: "file";
  path: string;
  size: number;
};

type DirNode = {
  type: "dir";
  path: string;
  children: Array<FileNode | DirNode>;
};

async function walkTree(root: string, dir: string): Promise<DirNode["children"]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: DirNode["children"] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      items.push({ type: "dir", path: rel, children: await walkTree(root, full) });
    } else if (entry.isFile()) {
      try {
        const s = await stat(full);
        items.push({ type: "file", path: rel, size: s.size });
      } catch {
        /* ignore */
      }
    }
  }
  // Directories first, then files, both alphabetically.
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return items;
}

function isPathSafe(workDir: string, requestedPath: string): boolean {
  // Defence in depth: require relative path with no parent traversal.
  if (requestedPath.includes("..")) return false;
  if (requestedPath.startsWith("/") || requestedPath.startsWith("\\")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(requestedPath)) return false;
  // Reject paths that resolve outside workDir.
  const resolved = join(workDir, requestedPath);
  return resolved.startsWith(workDir);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const generation = await prisma.generation.findUnique({
    where: { id },
    include: { project: { select: { userId: true } } },
  });
  if (!generation || generation.project.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const result = generation.result as { workDir?: string } | null;
  const workDir = result?.workDir;
  if (!workDir) {
    return NextResponse.json({ error: "workDir not recorded" }, { status: 410 });
  }

  const url = new URL(request.url);
  const requestedPath = url.searchParams.get("path");

  if (requestedPath) {
    if (!isPathSafe(workDir, requestedPath)) {
      return NextResponse.json({ error: "invalid path" }, { status: 400 });
    }
    const full = join(workDir, requestedPath);
    if (!isTextFile(requestedPath)) {
      return NextResponse.json({
        path: requestedPath,
        binary: true,
        content: null,
      });
    }
    try {
      const content = await readFile(full, "utf-8");
      return NextResponse.json({
        path: requestedPath,
        binary: false,
        content: content.slice(0, 200_000), // cap at 200KB to keep payload reasonable
      });
    } catch (err) {
      return NextResponse.json(
        { error: `cannot read file: ${(err as Error).message}` },
        { status: 404 },
      );
    }
  }

  const tree = await walkTree(workDir, workDir);
  return NextResponse.json({ workDir, tree });
}
