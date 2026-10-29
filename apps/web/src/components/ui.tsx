import type { ElementType, ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  Info,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import type { Tone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/** Cores semânticas por tom. Usam tokens do tema, então funcionam no claro e no escuro. */
export const toneClasses: Record<Tone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/35 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-info/30 bg-info/10 text-info",
  neutral: "border-border bg-secondary text-secondary-foreground",
};

const toneIcons: Record<Tone, ElementType> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  info: Info,
  neutral: Info,
};

export function Badge({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ShadcnBadge variant="outline" className={cn(toneClasses[tone], className)}>
      {children}
    </ShadcnBadge>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <Alert variant="destructive" className="border-destructive/30">
      <CircleAlert aria-hidden="true" />
      <AlertDescription className="text-destructive">{msg}</AlertDescription>
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
  const Icon = toneIcons[tone];
  return (
    <Alert className={toneClasses[tone]}>
      <Icon aria-hidden="true" />
      <AlertDescription className="text-foreground/90">
        {children}
      </AlertDescription>
    </Alert>
  );
}

export function Empty({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: ElementType;
  children?: ReactNode;
}) {
  return (
    <Card className="border border-dashed bg-transparent shadow-none ring-0">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        {Icon && <Icon aria-hidden="true" className="size-7 text-primary" />}
        <strong className="text-foreground">{title}</strong>
        {children && (
          <p className="m-0 max-w-md text-sm text-muted-foreground">
            {children}
          </p>
        )}
      </CardContent>
    </Card>
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
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export function Toolbar({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** Card sem padding vertical para envolver uma <Table>. */
export function TableCard({ children }: { children: ReactNode }) {
  return <Card className="gap-0 py-0">{children}</Card>;
}

export function Modal({
  title,
  description,
  onClose,
  children,
  wide,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[90vh] overflow-y-auto",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
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
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Label className={cn("grid min-w-0 items-start gap-1.5", className)}>
      <span>{label}</span>
      {children}
      {hint && (
        <small className="text-xs leading-snug font-normal text-muted-foreground">
          {hint}
        </small>
      )}
    </Label>
  );
}
