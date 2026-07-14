import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "./cn";

/*
 * Owned component (shadcn-style): the markup and API are ours; Tailwind and
 * semantic tokens are internal detail. When ds-button (Stencil DS) matures,
 * this file wraps the web component — consumers never change.
 */
type Variant = "primary" | "outline" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:opacity-90",
  outline: "border border-line bg-surface hover:bg-neutral-bg",
  ghost: "hover:bg-neutral-bg",
  danger: "bg-danger-bg text-danger hover:opacity-90",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded px-4 text-sm font-medium",
        "transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
