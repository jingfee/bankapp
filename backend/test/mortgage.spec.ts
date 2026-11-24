import type { INestApplication } from '@nestjs/common';
import type { MortgageResponse } from '@bankapp/shared';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, api as signedIn, testConfig } from './support';

describe('mortgage', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
      now: () => new Date('2026-11-20T12:00:00Z'),
    });
    await app.init();
  });
  afterEach(() => app.close());

  const api = () => signedIn(app);
  const post = (path: string, body: object = {}) => api().post(`/api/mortgage${path}`).send(body);
  const put = (path: string, body: object) => api().put(`/api/mortgage${path}`).send(body);

  const part = (name: string, extra: object = {}) => ({
    name,
    startedOn: '2026-01-10',
    debt: 1_000_000,
    rate: 3.85,
    amortisation: 2500,
    rateAdjustment: { next: '2026-11-15', intervalMonths: 3 },
    termsChange: { next: '2027-03-01', intervalMonths: 12 },
    ...extra,
  });

  async function twoParts(): Promise<MortgageResponse> {
    await post('/parts', part('Del 1 – 3 mån')).expect(201);
    const done = await post('/parts', part('Del 2 – 1 år', { debt: 500_000, rate: 4.1 })).expect(
      201,
    );
    return done.body;
  }

  it('is empty before it is set up', async () => {
    const { body } = await api().get('/api/mortgage').expect(200);
    expect(body).toEqual({ parts: [], entries: [] });
  });

  it('sets up a mortgage with two parts and one entry for their start day', async () => {
    const mortgage = await twoParts();
    expect(mortgage.parts.map((p) => [p.name, p.debt, p.rate, p.amortisation])).toEqual([
      ['Del 1 – 3 mån', 1_000_000, 3.85, 2500],
      ['Del 2 – 1 år', 500_000, 4.1, 2500],
    ]);
    expect(mortgage.entries).toHaveLength(1);
    expect(mortgage.entries[0]).toMatchObject({ date: '2026-01-10' });
    expect(mortgage.entries[0]?.debts.map((d) => d.debt)).toEqual([1_000_000, 500_000]);
  });

  it('renames a part, and ends one so that it counts as 0 and is listed last', async () => {
    const mortgage = await twoParts();
    const [first, second] = mortgage.parts;
    await put(`/parts/${first!.id}`, { name: 'Del A' }).expect(200);
    const ended = await post(`/parts/${first!.id}/end`, { date: '2026-11-01' }).expect(201);
    expect(ended.body.parts.map((p: { name: string }) => p.name)).toEqual([
      'Del 2 – 1 år',
      'Del A',
    ]);
    expect(ended.body.parts[1]).toMatchObject({
      endedOn: '2026-11-01',
      debt: 0,
      rate: 0,
      amortisation: 0,
    });
    expect(ended.body.parts[0].id).toBe(second!.id);
    await post(`/parts/${first!.id}/end`).expect(409);
    await post(`/parts/${first!.id}/rate-changes`, { rate: 3 }).expect(409);
  });

  it('drops an ended part from entries on or after its end day, so they stay editable', async () => {
    const [first, second] = (await twoParts()).parts;
    const both = [
      { partId: first!.id, debt: 900_000 },
      { partId: second!.id, debt: 450_000 },
    ];
    await post('/entries', { date: '2026-06-01', debts: both }).expect(201);
    const ended = await post(`/parts/${first!.id}/end`, { date: '2026-03-01' }).expect(201);
    const june = ended.body.entries.find((e: { date: string }) => e.date === '2026-06-01');
    expect(june.debts).toEqual([{ partId: second!.id, debt: 450_000 }]);
    await put(`/entries/${june.id}`, { date: '2026-06-01', debts: [june.debts[0]] }).expect(200);
    const january = ended.body.entries.find((e: { date: string }) => e.date === '2026-01-10');
    expect(january.debts).toHaveLength(2);
  });

  it('adds a part later, from a date', async () => {
    await twoParts();
    const added = await post('/parts', part('Del 3', { startedOn: '2026-11-10', debt: 200_000 }));
    expect(added.body.parts).toHaveLength(3);
    expect(added.body.entries.map((e: { date: string }) => e.date)).toEqual([
      '2026-11-10',
      '2026-01-10',
    ]);
  });

  describe('value in force', () => {
    it('is the latest rate and amortisation change on or before today', async () => {
      const [first] = (await twoParts()).parts;
      const id = first!.id;
      await post(`/parts/${id}/rate-changes`, { from: '2026-06-01', rate: 3.5 }).expect(201);
      await post(`/parts/${id}/rate-changes`, { from: '2026-11-20', rate: 3.9 }).expect(201);
      await post(`/parts/${id}/rate-changes`, { from: '2027-01-01', rate: 4.5 }).expect(201);
      await post(`/parts/${id}/amortisation-changes`, { from: '2026-09-01', amount: 0 }).expect(
        201,
      );
      const { body } = await api().get('/api/mortgage').expect(200);
      expect(body.parts[0]).toMatchObject({ rate: 3.9, amortisation: 0 });
      expect(body.parts[0].rateChanges.map((c: { from: string }) => c.from)).toEqual([
        '2027-01-01',
        '2026-11-20',
        '2026-06-01',
        '2026-01-10',
      ]);
    });

    it('allows the same rate again, and a correction for the same day replaces it', async () => {
      const [first] = (await twoParts()).parts;
      const id = first!.id;
      await post(`/parts/${id}/rate-changes`, { from: '2026-06-01', rate: 3.85 }).expect(201);
      const { body } = await post(`/parts/${id}/rate-changes`, { from: '2026-06-01', rate: 3.7 });
      expect(
        body.parts[0].rateChanges.filter((c: { from: string }) => c.from === '2026-06-01'),
      ).toHaveLength(1);
      expect(body.parts[0].rate).toBe(3.7);
    });

    it('defaults a change to today', async () => {
      const [first] = (await twoParts()).parts;
      const { body } = await post(`/parts/${first!.id}/amortisation-changes`, { amount: 5000 });
      expect(body.parts[0].amortisationChanges[0]).toMatchObject({
        from: '2026-11-20',
        amount: 5000,
      });
    });
  });

  describe('the rate prompt', () => {
    it('asks for a new rate once the adjustment day has passed, until one is dated on or after it', async () => {
      const [first] = (await twoParts()).parts;
      expect(first!.needsNewRate).toBe(true);
      const { body } = await post(`/parts/${first!.id}/rate-changes`, {
        from: '2026-11-15',
        rate: 3.85,
      }).expect(201);
      expect(body.parts.map((p: { needsNewRate: boolean }) => p.needsNewRate)).toEqual([
        false,
        true,
      ]);
    });

    it('does not ask for an ended part', async () => {
      const [first] = (await twoParts()).parts;
      const { body } = await post(`/parts/${first!.id}/end`, { date: '2026-11-20' }).expect(201);
      expect(body.parts.at(-1)).toMatchObject({ id: first!.id, needsNewRate: false });
    });
  });

  describe('recurring days', () => {
    it('reads the next rate adjustment day by adding the interval until it is ahead', async () => {
      const { parts } = await twoParts();
      expect(parts[0]?.rateAdjustment).toEqual({ next: '2027-02-15', intervalMonths: 3 });
      expect(parts[0]?.termsChange).toEqual({ next: '2027-03-01', intervalMonths: 12 });
    });

    it('moves the series when the date is edited, and changes the interval', async () => {
      const [first] = (await twoParts()).parts;
      const { body } = await put(`/parts/${first!.id}`, {
        rateAdjustment: { next: '2026-12-01', intervalMonths: 6 },
        termsChange: { next: '2027-06-30', intervalMonths: 24 },
      }).expect(200);
      expect(body.parts[0].rateAdjustment).toEqual({ next: '2026-12-01', intervalMonths: 6 });
      expect(body.parts[0].termsChange).toEqual({ next: '2027-06-30', intervalMonths: 24 });
      expect(body.parts[0].name).toBe('Del 1 – 3 mån');
    });
  });

  describe('mortgage entries', () => {
    it('adds, replaces for the same day, edits and deletes', async () => {
      const [first, second] = (await twoParts()).parts;
      const debts = (a: number, b: number) => [
        { partId: first!.id, debt: a },
        { partId: second!.id, debt: b },
      ];
      const added = await post('/entries', { debts: debts(990_000, 495_000) }).expect(201);
      expect(added.body.entries[0]).toMatchObject({ date: '2026-11-20' });
      expect(added.body.parts[0].debt).toBe(990_000);

      const replaced = await post('/entries', { debts: debts(980_000, 490_000) }).expect(201);
      expect(replaced.body.entries).toHaveLength(2);
      expect(replaced.body.entries[0].debts.map((d: { debt: number }) => d.debt)).toEqual([
        980_000, 490_000,
      ]);

      const id = replaced.body.entries[0].id;
      const edited = await put(`/entries/${id}`, { date: '2026-11-18', debts: debts(1, 2) }).expect(
        200,
      );
      expect(edited.body.entries[0]).toMatchObject({ id, date: '2026-11-18' });
      await put(`/entries/${id}`, { date: '2026-01-10', debts: debts(1, 2) }).expect(409);

      const deleted = await api().delete(`/api/mortgage/entries/${id}`).expect(200);
      expect(deleted.body.entries).toHaveLength(1);
      expect(deleted.body.parts[0].debt).toBe(1_000_000);
      await api().delete(`/api/mortgage/entries/${id}`).expect(404);
    });

    it('needs the debt of every open part, and of no ended part', async () => {
      const [first, second] = (await twoParts()).parts;
      await post('/entries', { debts: [{ partId: first!.id, debt: 1 }] }).expect(400);
      await post(`/parts/${first!.id}/end`, { date: '2026-11-01' }).expect(201);
      await post('/entries', { debts: [{ partId: second!.id, debt: 1 }] }).expect(201);
      await post('/entries', {
        debts: [
          { partId: first!.id, debt: 1 },
          { partId: second!.id, debt: 1 },
        ],
      }).expect(400);
      // Before the part ended, it was open and is needed.
      await post('/entries', {
        date: '2026-10-01',
        debts: [{ partId: second!.id, debt: 1 }],
      }).expect(400);
    });
  });

  describe('validation', () => {
    it.each([
      ['negative debt', { debt: -1 }],
      ['negative amortisation', { amortisation: -1 }],
      ['negative rate', { rate: -0.1 }],
      ['an interval of 0', { rateAdjustment: { next: '2026-12-01', intervalMonths: 0 } }],
      ['a fractional interval', { termsChange: { next: '2026-12-01', intervalMonths: 1.5 } }],
      ['a part starting in the future', { startedOn: '2026-11-21' }],
      ['a blank name', { name: ' ' }],
      ['a bad date', { rateAdjustment: { next: '2026-02-30', intervalMonths: 3 } }],
    ])('refuses %s when adding a part', async (_label, extra) => {
      await post('/parts', part('Del 1', extra)).expect(400);
      const { body } = await api().get('/api/mortgage');
      expect(body.parts).toEqual([]);
    });

    it('refuses negative amortisation changes and future or malformed entries', async () => {
      const [first, second] = (await twoParts()).parts;
      await post(`/parts/${first!.id}/amortisation-changes`, { amount: -5 }).expect(400);
      await post(`/parts/${first!.id}/rate-changes`, { rate: -1 }).expect(400);
      const debts = [
        { partId: first!.id, debt: 1 },
        { partId: second!.id, debt: 1 },
      ];
      await post('/entries', { date: '2026-11-21', debts }).expect(400);
      await post('/entries', {
        debts: [
          { partId: first!.id, debt: -1 },
          { partId: second!.id, debt: 1 },
        ],
      }).expect(400);
      await post('/entries', {
        debts: [
          { partId: first!.id, debt: 1 },
          { partId: first!.id, debt: 1 },
        ],
      }).expect(400);
    });

    it('answers 404 for an unknown part', async () => {
      await put('/parts/99', { name: 'x' }).expect(404);
      await post('/parts/99/end').expect(404);
      await post('/parts/abc/rate-changes', { rate: 1 }).expect(404);
    });
  });
});
