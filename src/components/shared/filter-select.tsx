"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** A compact select for filter and sort bars. `options` maps each value to its label. */
export function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  active,
  className,
  align,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: Record<T, string>
  /** Highlights the trigger when the filter is narrowing the list. */
  active: boolean
  className?: string
  align?: "start" | "end"
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger
        aria-label={label}
        className={cn("w-full bg-background sm:w-40", active && "border-primary/40", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align={align}>
        {(Object.keys(options) as T[]).map((key) => (
          <SelectItem key={key} value={key}>
            {options[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
