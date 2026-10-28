import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface SelectOption {
  value: string;
  label: ReactNode;
}

/**
 * Select do shadcn já montado. Recebe `items` para que o gatilho mostre o
 * rótulo da opção escolhida (e não o valor bruto, como um UUID).
 */
export function SelectField({
  value,
  onValueChange,
  options,
  placeholder = "Selecione…",
  disabled,
  required,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Select
      value={value || null}
      onValueChange={(next) => {
        if (next != null) onValueChange(next as string);
      }}
      items={options}
      disabled={disabled}
      required={required}
    >
      <SelectTrigger aria-label={ariaLabel} className={className ?? "w-full"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
