import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded border border-line bg-surface p-4 shadow-sm", className)}
      {...props}
    />
  );
}
