/*
 * UI facade — single entry point for components (same rule as nami-frontend,
 * enforced later with dependency-cruiser). Feature code imports ONLY from
 * "@/ui"; Tailwind classes and (future) Base UI primitives are internal.
 */

export { Badge, type BadgeProps } from "./Badge";
export { Button, type ButtonProps } from "./Button";
export { Card } from "./Card";
export { cn } from "./cn";
export { Field } from "./Field";
export { Input } from "./Input";
export { Select } from "./Select";
export { Skeleton } from "./Skeleton";
export { Textarea } from "./Textarea";
