import type { ReactNode } from "react";
import type { Tone } from "../lib/format";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge as ShadcnBadge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Skeleton } from "./ui/skeleton";

const toneClasses: Record<Tone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-primary/30 bg-primary/10 text-primary",
  neutral: "border-border bg-secondary text-secondary-foreground",
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <ShadcnBadge variant="outline" className={toneClasses[tone]}>
      {children}
    </ShadcnBadge>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <Alert variant="destructive">
      <AlertDescription>{msg}</AlertDescription>
    </Alert>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <Alert className={`mb-3 ${toneClasses[tone]}`}>{children}</Alert>;
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <Card className="border-dashed bg-transparent shadow-none">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <strong className="text-foreground">{title}</strong>
        {children && <p className="m-0 text-muted-foreground">{children}</p>}
      </CardContent>
    </Card>
  );
}

export function Spinner({ label = "Carregando…" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-3 p-4 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Skeleton className="size-4 rounded-full" />
      {label}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={
          wide
            ? "max-h-[90vh] overflow-y-auto sm:max-w-3xl"
            : "max-h-[90vh] overflow-y-auto sm:max-w-lg"
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="text-xs text-muted-foreground">{hint}</small>}
    </Label>
  );
}
