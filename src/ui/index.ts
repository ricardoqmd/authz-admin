/*
 * UI facade — single entry point for components (same rule as nami-frontend,
 * enforced later with dependency-cruiser). Feature code imports ONLY from
 * "@/ui"; Tailwind classes and (future) Base UI primitives are internal.
 */
export { Button, type ButtonProps } from "./Button";
export { Card } from "./Card";
export { Badge, type BadgeProps } from "./Badge";
export { Skeleton } from "./Skeleton";
export { cn } from "./cn";
