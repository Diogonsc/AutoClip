import { describe, expect, it } from 'vitest';
import { resolveLocalDateTime, utcToZonedInput, zonedToUtc } from './time';

describe('zonedToUtc', () => {
  it('converte horário de Brasília (UTC-3) para UTC', () => {
    expect(zonedToUtc('2026-10-20T18:00', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-10-20T21:00:00.000Z',
    );
  });

  it('respeita horário de verão de Londres (BST, UTC+1)', () => {
    expect(zonedToUtc('2026-07-01T12:00', 'Europe/London').toISOString()).toBe(
      '2026-07-01T11:00:00.000Z',
    );
  });

  it('respeita horário padrão de Londres no inverno (UTC+0)', () => {
    expect(zonedToUtc('2026-01-15T12:00', 'Europe/London').toISOString()).toBe(
      '2026-01-15T12:00:00.000Z',
    );
  });

  it('UTC é identidade', () => {
    expect(zonedToUtc('2026-03-05T09:30', 'UTC').toISOString()).toBe('2026-03-05T09:30:00.000Z');
  });
});

describe('utcToZonedInput', () => {
  it('faz o caminho inverso', () => {
    expect(utcToZonedInput('2026-10-20T21:00:00.000Z', 'America/Sao_Paulo')).toBe(
      '2026-10-20T18:00',
    );
  });

  it('ida e volta preserva o instante', () => {
    const iso = '2026-07-01T11:00:00.000Z';
    const local = utcToZonedInput(iso, 'Europe/London');
    expect(zonedToUtc(local, 'Europe/London').toISOString()).toBe(iso);
  });
});

describe('resolveLocalDateTime', () => {
  it('rejeita hora inexistente na transição de verão', () => {
    expect(resolveLocalDateTime('2026-03-29T01:30', 'Europe/London').kind).toBe('nonexistent');
  });
  it('retorna as duas ocorrências de hora ambígua em ordem UTC', () => {
    const result = resolveLocalDateTime('2026-10-25T01:30', 'Europe/London');
    expect(result.kind).toBe('ambiguous');
    expect(result.candidates.map((date) => date.toISOString())).toEqual([
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T01:30:00.000Z',
    ]);
  });
  it('identifica um fuso inválido e data malformada', () => {
    expect(resolveLocalDateTime('2026-01-01T09:00', 'Not/A_Zone').kind).toBe('invalid');
    expect(resolveLocalDateTime('2026-02-30T09:00', 'UTC').kind).toBe('invalid');
  });
});
