import { describe, expect, it } from "vitest";
import { buildReschedulePreview } from "./batchReschedule";
import type { PublicationJob } from "./types";

const job = (id: string, scheduled_at: string, status: string = "SCHEDULED") => ({ id, scheduled_at, status, created_at: `2026-10-${id.endsWith("1") ? "01" : "02"}T00:00:00Z` }) as PublicationJob;
const base = [job("job-2", "2026-11-02T10:00:00Z"), job("job-1", "2026-11-02T09:00:00Z"), job("job-3", "2026-11-02T11:00:00Z")];

describe("batch reschedule preview", () => {
  it.each([5, 30, 60, 45])("applies configurable %i minute spacing", (interval) => {
    const result = buildReschedulePreview(base, "2026-12-01T09:00", "UTC", interval, null);
    expect(result.map((item) => item.job.id)).toEqual(["job-1", "job-2", "job-3"]);
    expect(result.map((item) => item.scheduledAt)).toEqual([
      "2026-12-01T09:00:00.000Z",
      new Date(Date.parse("2026-12-01T09:00:00Z") + interval * 60_000).toISOString(),
      new Date(Date.parse("2026-12-01T09:00:00Z") + interval * 120_000).toISOString(),
    ]);
  });
  it("blocks past dates, invalid intervals and non-reschedulable states", () => {
    expect(buildReschedulePreview([job("job-1", "2026-11-02T09:00:00Z", "UNKNOWN")], "2026-12-01T09:00", "UTC", 30, null)[0].errors[0]).toContain("não permite");
    expect(buildReschedulePreview([base[0]], "2026-10-01T09:00", "UTC", 0, null)[0].errors).toContain("O intervalo deve ser um número inteiro entre 1 e 1440 minutos.");
    expect(buildReschedulePreview([base[0]], "2026-10-01T09:00", "UTC", 30, null)[0].errors).toContain("O novo horário deve estar no futuro.");
  });
  it("requires explicit selection for an ambiguous local time and rejects a DST gap", () => {
    const ambiguous = buildReschedulePreview([base[0]], "2026-10-25T01:30", "Europe/London", 30, null);
    expect(ambiguous[0].errors).toContain("Este horário ocorre duas vezes; escolha a primeira ou a segunda ocorrência.");
    const gap = buildReschedulePreview([base[0]], "2026-03-29T01:30", "Europe/London", 30, null);
    expect(gap[0].errors).toContain("Este horário local não existe devido à mudança de horário do fuso escolhido.");
  });
});
