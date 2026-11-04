/** Offset (ms) do fuso `tz` no instante `ts` (UTC ms): hora local - hora UTC. */
export function tzOffsetMs(ts: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ts));
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Converte "YYYY-MM-DDTHH:mm" (relógio de parede em `tz`) para o instante UTC correto. */
export function zonedToUtc(local: string, tz: string): Date {
  const [d, t] = local.split('T');
  const [y, m, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, da, h, mi);
  const off1 = tzOffsetMs(guess, tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

export type LocalDateTimeResolution = {
  kind: "valid" | "ambiguous" | "nonexistent" | "invalid";
  candidates: Date[];
};

/** Identifica horário local normal, repetido ou inexistente sem escolher silenciosamente um offset. */
export function resolveLocalDateTime(local: string, tz: string): LocalDateTimeResolution {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return { kind: "invalid", candidates: [] };
  const [, ys, ms, ds, hs, mins] = match;
  const [y, m, d, h, minute] = [ys, ms, ds, hs, mins].map(Number);
  const wall = Date.UTC(y, m - 1, d, h, minute);
  const verify = new Date(wall);
  if (verify.getUTCFullYear() !== y || verify.getUTCMonth() !== m - 1 || verify.getUTCDate() !== d || h > 23 || minute > 59) return { kind: "invalid", candidates: [] };
  try {
    const offsets = new Set<number>();
    // Amostra os offsets ao redor da data para capturar os dois lados de uma transição DST.
    for (let delta = -48; delta <= 48; delta += 6) offsets.add(tzOffsetMs(wall + delta * 3_600_000, tz));
    const candidates = [...offsets]
      .map((offset) => new Date(wall - offset))
      .filter((candidate) => utcToZonedInput(candidate.toISOString(), tz) === local)
      .sort((a, b) => a.getTime() - b.getTime());
    if (candidates.length === 0) return { kind: "nonexistent", candidates: [] };
    return { kind: candidates.length > 1 ? "ambiguous" : "valid", candidates };
  } catch {
    return { kind: "invalid", candidates: [] };
  }
}

/** Converte um instante ISO para o formato de <input type="datetime-local"> no fuso `tz`. */
export function utcToZonedInput(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function allTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['America/Sao_Paulo', 'UTC'];
  }
}
