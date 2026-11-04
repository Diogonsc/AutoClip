import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDb, type SbClient } from '../_shared/supabase-db.ts';

test('setChannelStatus updates the channel through the Db contract', async () => {
  const calls: Array<{ table: string; values?: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  let current: (typeof calls)[number] | undefined;
  const sb = {
    from(table: string) {
      current = { table, filters: [] };
      calls.push(current);
      return {
        update(values: Record<string, unknown>) {
          current!.values = values;
          return this;
        },
        eq(column: string, value: unknown) {
          current!.filters.push([column, value]);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SbClient;

  await createDb(sb).setChannelStatus('channel-1', 'PERMISSION_BLOCKED', 'MISSING_SCOPE', 'Required scope missing');

  assert.deepEqual(calls, [{
    table: 'channels',
    values: {
      connection_status: 'PERMISSION_BLOCKED',
      last_error_code: 'MISSING_SCOPE',
      last_error_message: 'Required scope missing',
    },
    filters: [['id', 'channel-1']],
  }]);
});
