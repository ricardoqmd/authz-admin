import { type HTMLAttributes } from "react";
import { cn } from "./cn";

type Tone = "success" | "neutral" | "danger";

const tones: Record<Tone, string> = {
  success: "bg-success-bg text-success",
  neutral: "bg-neutral-bg text-muted",
  danger: "bg-danger-bg text-danger",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
