"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconSearch,
} from "@tabler/icons-react";

import { studioColors, studioFonts } from "@/lib/styles/studio-tokens";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type FileNode = { type: "file"; path: string; size: number };
type DirNode = { type: "dir"; path: string; children: Array<FileNode | DirNode> };
type TreeNode = FileNode | DirNode;

type FileResponse =
  | { workDir: string; tree: TreeNode[] }
  | { path: string; binary: boolean; content: string | null };

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  prisma: "graphql", // Monaco doesn't have prisma; graphql is closest visual match
  yaml: "yaml",
  yml: "yaml",
};

function languageFor(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "plaintext";
  return EXT_TO_LANGUAGE[path.slice(lastDot + 1).toLowerCase()] ?? "plaintext";
}

function flatten(nodes: TreeNode[]): FileNode[] {
  const out: FileNode[] = [];
  function walk(items: TreeNode[]): void {
    for (const item of items) {
      if (item.type === "file") out.push(item);
      else walk(item.children);
    }
  }
  walk(nodes);
  return out;
}

function FileTree({
  nodes,
  filter,
  selected,
  onSelect,
  level = 0,
}: {
  nodes: TreeNode[];
  filter: string;
  selected: string | null;
  onSelect: (path: string) => void;
  level?: number;
}) {
  return (
    <ul className="select-none">
      {nodes.map((node) =>
        node.type === "dir" ? (
          <DirEntry
            key={node.path}
            node={node}
            filter={filter}
            selected={selected}
            onSelect={onSelect}
            level={level}
          />
        ) : (
          <FileEntry
            key={node.path}
            node={node}
            filter={filter}
            selected={selected}
            onSelect={onSelect}
            level={level}
          />
        ),
      )}
    </ul>
  );
}

function FileEntry({
  node,
  filter,
  selected,
  onSelect,
  level,
}: {
  node: FileNode;
  filter: string;
  selected: string | null;
  onSelect: (path: string) => void;
  level: number;
}) {
  if (filter && !node.path.toLowerCase().includes(filter.toLowerCase())) return null;
  const name = node.path.split("/").pop() ?? node.path;
  const isSelected = selected === node.path;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs transition-colors hover:bg-zinc-900/50"
        style={{
          paddingLeft: 8 + level * 12,
          color: isSelected ? studioColors.accentPrimary : studioColors.textSecondary,
          background: isSelected ? "rgba(139, 92, 246, 0.1)" : "transparent",
          fontFamily: studioFonts.mono,
        }}
      >
        <IconFile size={12} className="shrink-0 opacity-60" />
        <span className="truncate">{name}</span>
      </button>
    </li>
  );
}

function DirEntry({
  node,
  filter,
  selected,
  onSelect,
  level,
}: {
  node: DirNode;
  filter: string;
  selected: string | null;
  onSelect: (path: string) => void;
  level: number;
}) {
  // Expand by default if filtering or near top of tree.
  const [open, setOpen] = useState(filter !== "" || level < 2);
  const name = node.path.split("/").pop() ?? node.path;
  const visibleChildren = useMemo(() => {
    if (!filter) return node.children;
    return node.children.filter((c) => {
      if (c.type === "file") return c.path.toLowerCase().includes(filter.toLowerCase());
      return flatten([c]).some((f) => f.path.toLowerCase().includes(filter.toLowerCase()));
    });
  }, [node.children, filter]);
  if (filter && visibleChildren.length === 0) return null;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs transition-colors hover:bg-zinc-900/50"
        style={{
          paddingLeft: 8 + level * 12,
          color: studioColors.textSecondary,
          fontFamily: studioFonts.mono,
        }}
      >
        {open ? (
          <IconFolderOpen size={12} className="shrink-0 opacity-70" />
        ) : (
          <IconFolder size={12} className="shrink-0 opacity-70" />
        )}
        <span className="truncate">{name}/</span>
      </button>
      {open ? (
        <FileTree
          nodes={visibleChildren}
          filter={filter}
          selected={selected}
          onSelect={onSelect}
          level={level + 1}
        />
      ) : null}
    </li>
  );
}

export function MonacoPane({ generationId }: { generationId: string }) {
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Load the file tree once.
  useEffect(() => {
    let aborted = false;
    fetch(`/api/generate/${generationId}/files`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`tree fetch failed: ${r.status}`);
        return (await r.json()) as FileResponse;
      })
      .then((data) => {
        if (aborted) return;
        if ("tree" in data) {
          setTree(data.tree);
          // Auto-select a sensible first file.
          const flat = flatten(data.tree);
          const preferred =
            flat.find((f) => f.path === "prisma/schema.prisma") ??
            flat.find((f) => f.path.endsWith("README.md")) ??
            flat[0];
          if (preferred) setSelected(preferred.path);
        }
      })
      .catch((err) => {
        if (!aborted) setError((err as Error).message);
      });
    return () => {
      aborted = true;
    };
  }, [generationId]);

  // Load file content when selection changes.
  useEffect(() => {
    if (!selected) return;
    let aborted = false;
    setLoadingContent(true);
    fetch(`/api/generate/${generationId}/files?path=${encodeURIComponent(selected)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`file fetch failed: ${r.status}`);
        return (await r.json()) as FileResponse;
      })
      .then((data) => {
        if (aborted) return;
        if ("content" in data) {
          if (data.binary) {
            setContent(`// Binary file — cannot display\n// path: ${data.path}\n`);
          } else {
            setContent(data.content ?? "");
          }
        }
      })
      .catch((err) => {
        if (!aborted) setError((err as Error).message);
      })
      .finally(() => {
        if (!aborted) setLoadingContent(false);
      });
    return () => {
      aborted = true;
    };
  }, [generationId, selected]);

  const handleSelect = useCallback((path: string) => {
    setSelected(path);
  }, []);

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-md border"
      style={{ borderColor: studioColors.borderSubtle, background: studioColors.bgElevated }}
    >
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: studioColors.borderSubtle }}
      >
        <IconSearch size={12} style={{ color: studioColors.textMuted }} />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar archivos…"
          className="w-full bg-transparent text-xs focus:outline-none"
          style={{
            color: studioColors.textPrimary,
            fontFamily: studioFonts.mono,
          }}
        />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div
          className="w-[34%] overflow-y-auto border-r py-2"
          style={{ borderColor: studioColors.borderSubtle }}
        >
          {tree === null ? (
            <p className="px-3 py-4 text-xs" style={{ color: studioColors.textMuted }}>
              Cargando árbol…
            </p>
          ) : tree.length === 0 ? (
            <p className="px-3 py-4 text-xs" style={{ color: studioColors.textMuted }}>
              No hay archivos generados.
            </p>
          ) : (
            <FileTree
              nodes={tree}
              filter={filter}
              selected={selected}
              onSelect={handleSelect}
            />
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          {selected ? (
            <MonacoEditor
              key={selected}
              path={selected}
              value={content}
              language={languageFor(selected)}
              loading={
                <div
                  className="flex h-full items-center justify-center text-xs"
                  style={{ color: studioColors.textMuted }}
                >
                  Cargando editor…
                </div>
              }
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                lineHeight: 18,
                renderLineHighlight: "none",
                scrollBeyondLastLine: false,
                wordWrap: "on",
              }}
            />
          ) : (
            <div
              className="flex h-full items-center justify-center text-xs"
              style={{ color: studioColors.textMuted }}
            >
              {loadingContent ? "Cargando…" : "Seleccioná un archivo"}
            </div>
          )}
        </div>
      </div>
      {error ? (
        <div
          className="border-t px-3 py-1.5 text-[11px]"
          style={{
            borderColor: "rgba(239,68,68,0.4)",
            color: "#fecaca",
            background: "rgba(127,29,29,0.2)",
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
