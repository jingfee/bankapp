import type { INestApplication } from '@nestjs/common';
import type { HouseholdRatioResponse } from '@bankapp/shared';
import { createApp } from '../src/app';
import { inForceFrom } from '../src/transactions/shares';
import { FakeEnableBankingClient, api, testConfig } from './support';

describe('the household ratio in force', () => {
  const entries = [
    { from: '2026-03-01', percent: 60 },
    { from: '2026-07-01', percent: 55 },
    { from: '2026-12-01', percent: 50 },
  ];

  it.each([
    ['no entries', [], '2026-11-24', null],
    ['today before the first entry', entries, '2026-02-28', '2026-03-01'],
    ['today on the first entry', entries, '2026-03-01', '2026-03-01'],
    ['today between entries', entries, '2026-11-24', '2026-07-01'],
    ['today the day before an entry', entries, '2026-11-30', '2026-07-01'],
    ['today on an entry’s day', entries, '2026-12-01', '2026-12-01'],
    ['today after the last entry', entries, '2027-05-01', '2026-12-01'],
  ])('with %s gives the entry in force', (_name, list, today, expected) => {
    expect(inForceFrom(list, today)).toBe(expected);
  });

  describe('over HTTP', () => {
    let app: INestApplication;
    beforeEach(async () => {
      app = await createApp({
        config: testConfig,
        enableBanking: new FakeEnableBankingClient(),
        database: { inMemory: true },
      });
      await app.init();
    });
    afterEach(() => app.close());

    it('is null before any entry and present after setting the ratio', async () => {
      const empty = (await api(app).get('/api/household-ratio').expect(200))
        .body as HouseholdRatioResponse;
      expect(empty).toEqual({ entries: [], inForceFrom: null });
      const put = (
        await api(app)
          .put('/api/household-ratio')
          .send({ entries: [{ from: '2020-01-01', percent: 60 }] })
          .expect(200)
      ).body as HouseholdRatioResponse;
      expect(put.inForceFrom).toBe('2020-01-01');
      const got = (await api(app).get('/api/household-ratio').expect(200))
        .body as HouseholdRatioResponse;
      expect(got.inForceFrom).toBe('2020-01-01');
    });
  });
});
