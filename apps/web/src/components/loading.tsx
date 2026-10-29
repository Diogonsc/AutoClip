import { Loader } from "lucide-react";

export default function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <Loader className="size-6 animate-spin" aria-hidden="true" />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
