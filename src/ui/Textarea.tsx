import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded border border-line bg-surface p-3 font-mono text-xs",
        "placeholder:text-muted focus:outline-2 focus:outline-primary",
        "aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    />
  );
});
