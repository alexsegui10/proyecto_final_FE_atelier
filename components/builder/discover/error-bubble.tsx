"use client";

import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

type Props = {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
};

export function ErrorBubble({ message, onRetry, retrying }: Props) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200"
    >
      <div className="flex items-center gap-2 text-red-100">
        <IconAlertTriangle size={16} />
        <span className="font-medium">Algo falló</span>
      </div>
      {message ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-red-950/40 px-2 py-1 font-mono text-xs text-red-300/80">
{message}
        </pre>
      ) : null}
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-800/80 bg-red-900/40 px-3 py-1 text-xs font-medium text-red-100 transition-colors hover:border-red-700 hover:bg-red-900/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconRefresh size={12} />
        {retrying ? "Reintentando…" : "Reintentar"}
      </button>
    </div>
  );
}
