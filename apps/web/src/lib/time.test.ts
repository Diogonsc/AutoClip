import { describe, expect, it } from 'vitest';
import { utcToZonedInput, zonedToUtc } from './time';

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
