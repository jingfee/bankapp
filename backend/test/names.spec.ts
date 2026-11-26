import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';
import { partnerPossessive } from '../src/names/possessive';
import { FakeEnableBankingClient, api, testConfig } from './support';

describe('GET /api/names', () => {
  let app: INestApplication;

  afterEach(async () => app.close());

  it('gives the configured names', async () => {
    app = await createApp({
      config: { ...testConfig, ownerName: 'Kim', partnerName: 'Robin' },
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
    });
    await app.init();
    const body = (await api(app).get('/api/names').expect(200)).body as unknown;
    expect(body).toEqual({ owner: 'Kim', partner: 'Robin' });
  });
});

describe('partnerPossessive', () => {
  it.each([
    ['Robin', 'Robins'],
    ['Lars', 'Lars'],
    ['Max', 'Max'],
    ['Partner', 'Partnerns'],
  ])('makes %s into %s', (name, expected) => {
    expect(partnerPossessive(name)).toBe(expected);
  });
});
