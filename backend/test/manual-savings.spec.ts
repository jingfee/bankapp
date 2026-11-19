import type { INestApplication } from '@nestjs/common';
import type { ManualSavingsAccount } from '@bankapp/shared';
import { createApp } from '../src/app';
import { ManualSavings } from '../src/manual-savings/manual-savings';
import { FakeEnableBankingClient, api as signedIn, testConfig } from './support';

describe('manual savings accounts', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
      now: () => new Date('2026-12-15T12:00:00Z'),
    });
    await app.init();
  });
  afterEach(() => app.close());

  const api = () => signedIn(app);
  const post = (path: string, body: object = {}) =>
    api().post(`/api/manual-savings-accounts${path}`).send(body);
  const put = (path: string, body: object) =>
    api().put(`/api/manual-savings-accounts${path}`).send(body);

  async function isk(): Promise<ManualSavingsAccount> {
    const created = await post('', { name: 'Avanza ISK', institution: 'Avanza' }).expect(201);
    await post(`/${created.body.id}/entries`, {
      date: '2026-10-28',
      balance: 400000,
      netDeposits: 300000,
    }).expect(201);
    const done = await post(`/${created.body.id}/entries`, {
      date: '2026-11-27',
      balance: 409500,
      netDeposits: 305000,
    }).expect(201);
    return done.body;
  }

  it('creates an account with a name and an optional institution, and renames it', async () => {
    const created = await post('', { name: ' Avanza ISK ' }).expect(201);
    expect(created.body).toMatchObject({
      name: 'Avanza ISK',
      institution: null,
      closedOn: null,
      entries: [],
      balance: null,
    });
    const renamed = await put(`/${created.body.id}`, { name: 'ISK', institution: 'Avanza' });
    expect(renamed.body).toMatchObject({ name: 'ISK', institution: 'Avanza' });
    expect((await api().get('/api/manual-savings-accounts')).body.accounts).toHaveLength(1);
  });

  it('needs a name', async () => {
    await post('', { name: ' ' }).expect(400);
    await put('/999', { name: 'x' }).expect(404);
  });

  it('derives deposits, growth and growth since opening from the entries', async () => {
    const account = await isk();
    expect(account.entries.map((entry) => entry.date)).toEqual(['2026-11-27', '2026-10-28']);
    expect(account).toMatchObject({
      balance: 409500,
      netDeposits: 305000,
      growth: 104500,
      growthApproximate: false,
    });
    const savings = app.get(ManualSavings);
    expect(savings.changeBetween('2026-10-31', '2026-11-30')).toEqual([
      { accountId: account.id, change: { deposits: 5000, growth: 4500, approximate: false } },
    ]);
    expect(savings.figuresOn('2026-11-01')).toEqual([
      { accountId: account.id, state: { balance: 400000, netDeposits: 300000, closed: false } },
    ]);
  });

  it('replaces the entry of a day entered again', async () => {
    const { id } = await isk();
    const again = await post(`/${id}/entries`, {
      date: '2026-11-27',
      balance: 410000,
      netDeposits: 305000,
    }).expect(201);
    expect(again.body.entries).toHaveLength(2);
    expect(again.body.balance).toBe(410000);
  });

  it('carries net deposits forward from an entry without them and says growth is approximate', async () => {
    const { id } = await isk();
    const account = await post(`/${id}/entries`, { date: '2026-12-10', balance: 412000 }).expect(
      201,
    );
    expect(account.body).toMatchObject({
      balance: 412000,
      netDeposits: 305000,
      growth: 107000,
      growthApproximate: true,
    });
  });

  it('has balance only when no entry has net deposits', async () => {
    const created = await post('', { name: 'Sparkonto' });
    const account = await post(`/${created.body.id}/entries`, { balance: 5000 }).expect(201);
    expect(account.body).toMatchObject({
      balance: 5000,
      netDeposits: null,
      growth: null,
      entries: [{ date: '2026-12-15', balance: 5000, netDeposits: null }],
    });
  });

  it('edits and deletes entries', async () => {
    const { id, entries } = await isk();
    const newest = entries[0]!;
    const edited = await put(`/${id}/entries/${newest.id}`, {
      date: '2026-11-28',
      balance: 409000,
      netDeposits: null,
    }).expect(200);
    expect(edited.body.entries[0]).toMatchObject({ date: '2026-11-28', balance: 409000 });
    await put(`/${id}/entries/${newest.id}`, { date: '2026-10-28', balance: 1 }).expect(409);
    const removed = await api()
      .delete(`/api/manual-savings-accounts/${id}/entries/${newest.id}`)

      .expect(200);
    expect(removed.body.entries).toHaveLength(1);
    await api()
      .delete(`/api/manual-savings-accounts/${id}/entries/${newest.id}`)

      .expect(404);
  });

  it('counts as 0 once closed, keeps its history, asks for no more entries, and can be reopened', async () => {
    const { id } = await isk();
    const closed = await post(`/${id}/close`, { date: '2026-12-15' }).expect(201);
    expect(closed.body).toMatchObject({ closedOn: '2026-12-15', balance: 0, growth: null });
    expect(closed.body.entries).toHaveLength(2);
    const savings = app.get(ManualSavings);
    expect(savings.figuresOn('2026-12-14')[0]!.state.balance).toBe(409500);
    expect(savings.figuresOn('2026-12-15')[0]!.state.balance).toBe(0);
    await post(`/${id}/entries`, { balance: 1 }).expect(409);
    const reopened = await post(`/${id}/reopen`).expect(201);
    expect(reopened.body).toMatchObject({ closedOn: null, balance: 409500 });
  });

  it('closes today by default', async () => {
    const { id } = await isk();
    expect((await post(`/${id}/close`)).body.closedOn).toBe('2026-12-15');
  });

  it.each([
    ['a future date', { date: '2026-12-16', balance: 1 }],
    ['a missing balance', { date: '2026-12-01' }],
    ['a text balance', { balance: '5 000' }],
    ['a text net deposits', { balance: 1, netDeposits: 'x' }],
    ['a bad date', { date: '2026-02-30', balance: 1 }],
  ])('refuses %s', async (_, body) => {
    const { id } = await isk();
    await post(`/${id}/entries`, body).expect(400);
  });

  it('refuses a future closing date and answers 404 for unknown accounts and entries', async () => {
    const { id } = await isk();
    await post(`/${id}/close`, { date: '2027-01-01' }).expect(400);
    await post(`/${id}/close`, { date: '2026-11-01' }).expect(400);
    await post('/999/entries', { balance: 1 }).expect(404);
    await put(`/${id}/entries/999`, { balance: 1 }).expect(404);
  });
});
