import type { INestApplication } from '@nestjs/common';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { syncRuns } from '../src/db/schema';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig } from './support';

describe('scheduled syncs', () => {
  let app: INestApplication;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
  });

  afterEach(async () => {
    await app?.close();
    vi.useRealTimers();
  });

  async function startAt(now: string, scheduledSyncs: boolean): Promise<void> {
    vi.setSystemTime(new Date(now));
    app = await createApp({
      config: { ...testConfig, scheduledSyncs },
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
    });
    await app.init();
  }

  const runs = () =>
    (app.get(DATABASE) as AppDatabase)
      .select({ trigger: syncRuns.trigger, startedAt: syncRuns.startedAt })
      .from(syncRuns)
      .all()
      .map((run) => ({ trigger: run.trigger, startedAt: run.startedAt.toISOString() }));

  it('syncs at 06:00 and 18:00 Stockholm time when the flag is on', async () => {
    // 2026-07-01 is CEST (UTC+2): 06:00 local is 04:00 UTC and 18:00 local is 16:00 UTC.
    await startAt('2026-07-01T03:00:00Z', true);

    await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
    expect(runs()).toEqual([]);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(runs()).toEqual([{ trigger: 'scheduled', startedAt: '2026-07-01T04:00:00.000Z' }]);

    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    expect(runs().map((run) => run.startedAt)).toEqual([
      '2026-07-01T04:00:00.000Z',
      '2026-07-01T16:00:00.000Z',
    ]);
    expect(runs().every((run) => run.trigger === 'scheduled')).toBe(true);
  });

  it('follows winter time too', async () => {
    // 2026-12-01 is CET (UTC+1): 06:00 local is 05:00 UTC.
    await startAt('2026-12-01T04:30:00Z', true);

    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

    expect(runs()).toEqual([{ trigger: 'scheduled', startedAt: '2026-12-01T05:00:00.000Z' }]);
  });

  it('never syncs on a schedule when the flag is off', async () => {
    await startAt('2026-07-01T00:00:00Z', false);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(runs()).toEqual([]);
  });
});
