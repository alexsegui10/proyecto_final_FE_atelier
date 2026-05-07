import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1 text-sm text-zinc-100 shadow-sm transition-colors",
        "placeholder:text-zinc-500",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-500",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
