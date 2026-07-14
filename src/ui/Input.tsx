import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded border border-line bg-surface px-3 text-sm",
          "placeholder:text-muted focus:outline-2 focus:outline-primary",
          "aria-[invalid=true]:border-danger",
          className,
        )}
        {...props}
      />
    );
  },
);
