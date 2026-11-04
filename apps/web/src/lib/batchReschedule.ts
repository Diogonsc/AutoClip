import type { PublicationJob } from "./types";
import { resolveLocalDateTime } from "./time";

export interface ReschedulePreviewItem {
  job: PublicationJob;
  scheduledAt: string | null;
  errors: string[];
}

const reschedulable = new Set(["SCHEDULED", "READY", "RETRY_WAIT"]);

export function buildReschedulePreview(
  jobs: PublicationJob[],
  localStart: string,
  timezone: string,
  intervalMinutes: number,
  ambiguousOccurrence: number | null,
): ReschedulePreviewItem[] {
  const ordered = orderRescheduleJobs(jobs);
  const intervalValid = Number.isInteger(intervalMinutes) && intervalMinutes >= 1 && intervalMinutes <= 1440;
  const resolution = localStart ? resolveLocalDateTime(localStart, timezone) : { kind: "invalid" as const, candidates: [] };
  const start = resolution.kind === "valid" ? resolution.candidates[0] : resolution.kind === "ambiguous" && ambiguousOccurrence !== null ? resolution.candidates[ambiguousOccurrence] : undefined;
  return ordered.map((job, index) => {
    const errors: string[] = [];
    if (!reschedulable.has(job.status)) errors.push(`Estado ${job.status} não permite reagendamento.`);
    if (!intervalValid) errors.push("O intervalo deve ser um número inteiro entre 1 e 1440 minutos.");
    if (!localStart) errors.push("Informe a nova data e hora inicial.");
    else if (resolution.kind === "nonexistent") errors.push("Este horário local não existe devido à mudança de horário do fuso escolhido.");
    else if (resolution.kind === "invalid") errors.push("Data, hora ou fuso inválido.");
    else if (resolution.kind === "ambiguous" && ambiguousOccurrence === null) errors.push("Este horário ocorre duas vezes; escolha a primeira ou a segunda ocorrência.");
    else if (!start) errors.push("Escolha uma ocorrência válida para o horário ambíguo.");
    const scheduledAt = start && intervalValid ? new Date(start.getTime() + index * intervalMinutes * 60_000).toISOString() : null;
    if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) errors.push("O novo horário deve estar no futuro.");
    return { job, scheduledAt, errors };
  });
}

export function orderRescheduleJobs(jobs: PublicationJob[]) {
  return [...jobs].sort((a, b) => {
    const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  });
}
