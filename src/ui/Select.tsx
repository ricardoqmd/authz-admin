import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "./cn";

/** Native select, styled. Swaps to a composed listbox (Base UI) if/when a
 *  richer Combobox is needed — the API stays ours either way. */
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        "h-9 w-full rounded border border-line bg-surface px-2 text-sm",
        "focus:outline-2 focus:outline-primary",
        className,
      )}
      {...props}
    />
  );
});
