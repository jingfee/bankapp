import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import type { BanksResponse } from '@bankapp/shared';
import { createApp } from '../src/app';
import { BANK_REFRESH_JOB } from '../src/banks/bank-refresh.scheduler';
import { bank, FakeEnableBankingClient, testConfig } from './support';

describe('bank list', () => {
  let app: INestApplication;
  let enableBanking: FakeEnableBankingClient;

  beforeEach(() => {
    enableBanking = new FakeEnableBankingClient();
  });

  afterEach(() => app.close());

  async function start(): Promise<void> {
    app = await createApp({ config: testConfig, enableBanking, database: { inMemory: true } });
    await app.init();
  }

  const getBanks = async (): Promise<BanksResponse> =>
    (await request(app.getHttpServer()).get('/api/banks').expect(200)).body;

  it('lists the Swedish banks sorted by name, marking beta banks', async () => {
    enableBanking.banks = [
      bank('Swedbank', { logoUrl: 'https://logos.example/swedbank.png' }),
      bank('Northmill', { beta: true }),
      bank('Skandia'),
    ];

    await start();

    expect(await getBanks()).toEqual({
      banks: [
        { name: 'Northmill', logoUrl: null, beta: true },
        { name: 'Skandia', logoUrl: null, beta: false },
        { name: 'Swedbank', logoUrl: 'https://logos.example/swedbank.png', beta: false },
      ],
    });
    expect(enableBanking.requestedCountries).toEqual(['SE']);
  });

  it('starts with an empty list when Enable Banking cannot be reached', async () => {
    enableBanking.failWith = new Error('offline');

    await start();

    expect(await getBanks()).toEqual({ banks: [] });
  });

  describe('daily refresh', () => {
    const fireDailyRefresh = async () => {
      app.get(SchedulerRegistry).getCronJob(BANK_REFRESH_JOB).fireOnTick();
      // The tick is fire-and-forget; let its promise chain settle.
      await new Promise((resolve) => setTimeout(resolve, 20));
    };

    it('schedules the refresh in the configured time zone', async () => {
      await start();

      const job = app.get(SchedulerRegistry).getCronJob(BANK_REFRESH_JOB);
      expect(job.isActive).toBe(true);
      expect(job.cronTime.timeZone).toBe('Europe/Stockholm');
    });

    it('replaces the cached banks with the current ones', async () => {
      enableBanking.banks = [bank('Skandia'), bank('Gammalbanken')];
      await start();

      enableBanking.banks = [bank('Skandia'), bank('Nybanken', { beta: true })];
      await fireDailyRefresh();

      expect((await getBanks()).banks.map((b) => b.name)).toEqual(['Nybanken', 'Skandia']);
    });

    it('keeps the cached banks when the refresh fails', async () => {
      enableBanking.banks = [bank('Skandia')];
      await start();

      enableBanking.failWith = new Error('offline');
      await fireDailyRefresh();

      expect((await getBanks()).banks.map((b) => b.name)).toEqual(['Skandia']);
    });
  });
});
