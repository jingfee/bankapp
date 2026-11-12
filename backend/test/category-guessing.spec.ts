import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  CategoriesResponse,
  TransactionCategory,
  TransactionDetails,
  TransactionsResponse,
} from '@bankapp/shared';
import { createApp } from '../src/app';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, transactions } from '../src/db/schema';
import type { EnableBankingTransaction } from '../src/enable-banking/enable-banking-client';
import { MIN_TRAINING_EXAMPLES } from '../src/categories/guessing/text-classifier';
import { SyncService } from '../src/sync/sync.service';
import { bank, FakeEnableBankingClient, testConfig } from './support';

let nextReference = 1;

/** A booked transaction as the bank sends it; `mcc` is the card network's merchant category code. */
function transaction(
  description: string,
  { mcc, ...overrides }: Partial<EnableBankingTransaction> & { mcc?: string } = {},
): EnableBankingTransaction {
  const raw: Record<string, unknown> = { remittance_information: [description] };
  if (mcc !== undefined) raw['merchant_category_code'] = mcc;
  return {
    status: 'booked',
    amount: -100,
    currency: 'SEK',
    bookingDate: '2026-11-09',
    valueDate: '2026-11-09',
    transactionDate: null,
    description,
    entryReference: `ref-${nextReference++}`,
    raw: JSON.stringify(raw),
    ...overrides,
  };
}

/** Reads the API's category as "Category / Subcategory", with a `?` when it is only a guess. */
function shown(category: TransactionCategory | null): string | null {
  if (category === null) return null;
  return `${category.category.name} / ${category.subcategory.name}${category.confirmed ? '' : ' ?'}`;
}

describe('guessing categories', () => {
  let app: INestApplication;
  let enableBanking: FakeEnableBankingClient;
  let now: Date;

  beforeEach(async () => {
    enableBanking = new FakeEnableBankingClient();
    enableBanking.banks = [bank('Coop Mastercard')];
    now = new Date('2026-11-10T12:00:00.000Z');
    app = await createApp({
      config: testConfig,
      enableBanking,
      database: { inMemory: true },
      now: () => now,
    });
    await app.init();
    enableBanking.session = {
      sessionId: 'session',
      validUntil: new Date('2027-02-08T12:00:00.000Z'),
      accounts: [
        {
          uid: 'u1',
          identificationHash: 'hash-u1',
          name: 'Kortkonto',
          type: 'card',
          currency: 'SEK',
          raw: '{}',
        },
      ],
    };
    await request(app.getHttpServer()).post('/api/connections').send({ bank: 'Coop Mastercard' });
    const { state } = enableBanking.authorisations.at(-1)!;
    await request(app.getHttpServer())
      .get('/api/connections/callback')
      .query({ code: 'code', state })
      .expect(302);
    await sync();
  });

  afterEach(() => app.close());

  /** Waits for any sync running (such as the initial one) and runs a manual one. */
  async function sync(): Promise<void> {
    await vi.waitFor(() => expect(app.get(SyncService).isSyncing()).toBe(false));
    await app.get(SyncService).start('manual').finished;
  }

  async function syncWith(...fetched: EnableBankingTransaction[]): Promise<void> {
    enableBanking.transactions.set('u1', fetched);
    await sync();
  }

  /** Every transaction's description and category as listed, oldest first. */
  async function listed(): Promise<[string, string | null][]> {
    const body = (await request(app.getHttpServer()).get('/api/transactions').expect(200))
      .body as TransactionsResponse;
    return body.transactions
      .map((t): [string, string | null] => [t.description, shown(t.category)])
      .reverse();
  }

  async function idOf(description: string): Promise<number> {
    const body = (await request(app.getHttpServer()).get('/api/transactions').expect(200))
      .body as TransactionsResponse;
    return body.transactions.find((t) => t.description === description)!.id;
  }

  async function subcategoryId(category: string, subcategory: string): Promise<number> {
    const body = (await request(app.getHttpServer()).get('/api/categories').expect(200))
      .body as CategoriesResponse;
    return body.categories
      .find((c) => c.name === category)!
      .subcategories.find((s) => s.name === subcategory)!.id;
  }

  async function confirm(description: string, category: string, subcategory: string) {
    await request(app.getHttpServer())
      .put(`/api/transactions/${await idOf(description)}/category`)
      .send({ subcategoryId: await subcategoryId(category, subcategory) })
      .expect(200);
  }

  it('guesses from the Swedish merchant keywords, whatever the case, accents or store', async () => {
    await syncWith(
      transaction('ICA NARA VEGA'),
      transaction('Hemköp Stockholm City'),
      transaction('HEMKOP VASTERHANINGE'),
      transaction('LIDL350SOLNACENTRUM'),
      transaction('Systembolaget Haninge'),
      transaction('SL APP'),
      transaction('Spotify P1234ABCD'),
      transaction('Apoteket Solen'),
      transaction('Kronans Apotek AB'),
    );

    expect(await listed()).toEqual([
      ['ICA NARA VEGA', 'Mat & Dryck / Livsmedel ?'],
      ['Hemköp Stockholm City', 'Mat & Dryck / Livsmedel ?'],
      ['HEMKOP VASTERHANINGE', 'Mat & Dryck / Livsmedel ?'],
      ['LIDL350SOLNACENTRUM', 'Mat & Dryck / Livsmedel ?'],
      ['Systembolaget Haninge', 'Mat & Dryck / Alkohol ?'],
      ['SL APP', 'Transport / Kollektivtrafik ?'],
      ['Spotify P1234ABCD', 'Nöje & Fritid / Streaming & prenumerationer ?'],
      ['Apoteket Solen', 'Hälsa & Skönhet / Apotek ?'],
      ['Kronans Apotek AB', 'Hälsa & Skönhet / Apotek ?'],
    ]);
  });

  it('matches keywords as whole words only', async () => {
    await syncWith(transaction('Slöjd-Detaljer'), transaction('Musica Butiken'));

    expect(await listed()).toEqual([
      ['Slöjd-Detaljer', null],
      ['Musica Butiken', null],
    ]);
  });

  it('pays the card bill as a transfer rather than groceries', async () => {
    await syncWith(
      transaction('Coop Mastercard', { amount: -5000 }),
      transaction('COOP_MASTERCARD', { amount: -4000 }),
    );

    expect(await listed()).toEqual([
      ['Coop Mastercard', 'Överföring / Kortbetalning ?'],
      ['COOP_MASTERCARD', 'Överföring / Kortbetalning ?'],
    ]);
  });

  it('does not take the bank ICA Banken for the ICA stores', async () => {
    await syncWith(transaction('Överföring ICA Banken'), transaction('ICA Banken Lån'));

    expect((await listed()).map(([, category]) => category)).toEqual([null, null]);
  });

  it('guesses a pending transaction again when it books, from what the booked one says', async () => {
    await syncWith(transaction('Trattoria Ett', { status: 'pending', entryReference: 'p1' }));
    expect(await listed()).toEqual([['Trattoria Ett', null]]);

    await syncWith(transaction('Trattoria Ett', { entryReference: 'b1', mcc: '5812' }));

    expect(await listed()).toEqual([['Trattoria Ett', 'Mat & Dryck / Restaurang ?']]);
  });

  it('does not guess again when the owner made a pending transaction uncategorised and it books', async () => {
    for (const entryReference of [null, 'p9']) {
      const description = `Trattoria ${entryReference ?? 'Utan'}`;
      await syncWith(transaction(description, { status: 'pending', entryReference, mcc: '5812' }));
      await request(app.getHttpServer())
        .put(`/api/transactions/${await idOf(description)}/category`)
        .send({ subcategoryId: null })
        .expect(200);

      await syncWith(transaction(description, { entryReference: `${description}-b`, mcc: '5812' }));

      expect((await listed()).find(([d]) => d === description)).toEqual([description, null]);
    }
  });

  it('falls back to the merchant category code, and prefers a keyword over it', async () => {
    await syncWith(
      transaction('Trattoria Okänd', { mcc: '5812' }),
      transaction('Hamburgerbaren', { mcc: '5814' }),
      transaction('Bageri Kanel', { mcc: '5462' }),
      transaction('Taxi Kurir', { mcc: '4121' }),
      transaction('Tågbolaget', { mcc: '4112' }),
      transaction('Systembolaget Haninge', { mcc: '5411' }),
    );

    expect(await listed()).toEqual([
      ['Trattoria Okänd', 'Mat & Dryck / Restaurang ?'],
      ['Hamburgerbaren', 'Mat & Dryck / Snabbmat & hämtmat ?'],
      ['Bageri Kanel', 'Mat & Dryck / Café & fika ?'],
      ['Taxi Kurir', 'Transport / Taxi ?'],
      ['Tågbolaget', 'Resor / Flyg & tåg ?'],
      ['Systembolaget Haninge', 'Mat & Dryck / Alkohol ?'],
    ]);
  });

  it('leaves catch-all codes, and transactions without a code, uncategorised', async () => {
    await syncWith(
      transaction('Diverse Butik', { mcc: '5999' }),
      transaction('Kiosken', { mcc: '5499' }),
      transaction('Swish till Anna Andersson'),
      transaction('Autogiro Försäkringsbolaget'),
      transaction('Okänd', { raw: 'not json' }),
    );

    expect((await listed()).map(([, category]) => category)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('reuses the category the owner confirmed for the same description, before keywords', async () => {
    await syncWith(transaction('Kiosken Vega 12'), transaction('ICA Nära Vega'));
    await confirm('Kiosken Vega 12', 'Mat & Dryck', 'Café & fika');
    await confirm('ICA Nära Vega', 'Boende & Hushåll', 'Hushållsartiklar');

    await syncWith(transaction('KIOSKEN VEGA 34'), transaction('ICA Nära  Vega'));

    expect((await listed()).slice(2)).toEqual([
      ['KIOSKEN VEGA 34', 'Mat & Dryck / Café & fika ?'],
      ['ICA Nära  Vega', 'Boende & Hushåll / Hushållsartiklar ?'],
    ]);
  });

  it('reuses the most recently confirmed category when several were confirmed', async () => {
    await syncWith(transaction('Kiosken Vega 1'), transaction('Kiosken Vega 2'));
    await confirm('Kiosken Vega 2', 'Mat & Dryck', 'Café & fika');
    now = new Date(now.getTime() + 60_000);
    await confirm('Kiosken Vega 1', 'Mat & Dryck', 'Snabbmat & hämtmat');

    await syncWith(transaction('Kiosken Vega 3'));

    expect((await listed()).at(-1)).toEqual([
      'Kiosken Vega 3',
      'Mat & Dryck / Snabbmat & hämtmat ?',
    ]);
  });

  it('does not reuse a guess, only a confirmed category', async () => {
    await syncWith(transaction('Restaurang Ett', { mcc: '5812' }));

    await syncWith(transaction('Restaurang Ett'));

    expect((await listed()).at(-1)).toEqual(['Restaurang Ett', null]);
  });

  it('never changes a confirmed category, and does not guess again after the owner removed one', async () => {
    const pending = transaction('ICA Nära Vega', { status: 'pending', entryReference: 'p1' });
    const other = transaction('Willys Haninge', { status: 'pending', entryReference: 'p2' });
    await syncWith(pending, other);
    await confirm('ICA Nära Vega', 'Mat & Dryck', 'Alkohol');
    await request(app.getHttpServer())
      .put(`/api/transactions/${await idOf('Willys Haninge')}/category`)
      .send({ subcategoryId: null })
      .expect(200);

    await syncWith(pending, other);
    await syncWith(
      transaction('ICA Nära Vega', { entryReference: 'b1' }),
      transaction('Willys Haninge', { entryReference: 'b2' }),
    );

    expect(await listed()).toEqual([
      ['ICA Nära Vega', 'Mat & Dryck / Alkohol'],
      ['Willys Haninge', null],
    ]);
  });

  it('shows a guess on the detail page as not confirmed', async () => {
    await syncWith(transaction('Willys Haninge'));

    const details = (
      await request(app.getHttpServer())
        .get(`/api/transactions/${await idOf('Willys Haninge')}`)
        .expect(200)
    ).body as TransactionDetails;
    expect(details.category).toMatchObject({
      subcategory: { name: 'Livsmedel' },
      confirmed: false,
    });
  });

  describe('from the owner’s confirmed categories', () => {
    /** How many confirmed categories the classifier needs before it guesses (`MIN_TRAINING_EXAMPLES`). */
    const HISTORY_SIZE = MIN_TRAINING_EXAMPLES;

    /**
     * Confirms enough different restaurants, cafés and salons for the classifier to have something
     * to learn from: the ten named ones, then salons with distinct names up to the minimum.
     */
    async function confirmHistory() {
      const history: [string, string, string][] = [
        ['Pizzeria Napoli Solna', 'Mat & Dryck', 'Restaurang'],
        ['Trattoria Bella Vista', 'Mat & Dryck', 'Restaurang'],
        ['Sushi Yama Kungsgatan', 'Mat & Dryck', 'Restaurang'],
        ['Thai Orkidé Södermalm', 'Mat & Dryck', 'Restaurang'],
        ['Pizzeria Roma Haninge', 'Mat & Dryck', 'Restaurang'],
        ['Bageriet Vete Götgatan', 'Mat & Dryck', 'Café & fika'],
        ['Kafferosteriet Bönan', 'Mat & Dryck', 'Café & fika'],
        ['Bageriet Surdeg Solna', 'Mat & Dryck', 'Café & fika'],
        ['Fikarummet Kanel', 'Mat & Dryck', 'Café & fika'],
        ['Kafferosteriet Mörkrost', 'Mat & Dryck', 'Café & fika'],
      ];
      for (let i = history.length; i < HISTORY_SIZE; i++) {
        const name = String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + (i >> 1));
        history.push([`Salong ${name}ka`, 'Hälsa & Skönhet', 'Frisör & skönhet']);
      }
      await syncWith(...history.map(([description]) => transaction(description)));
      for (const [description, category, subcategory] of history) {
        await confirm(description, category, subcategory);
      }
    }

    it('guesses a variant of a merchant the owner has confirmed, but not an unrelated description', async () => {
      await confirmHistory();

      await syncWith(
        transaction('Pizzeria Napoli Haninge'),
        transaction('Kafferosteriet Bönan Vega'),
        transaction('Mekaniker Lindqvist Verkstad'),
      );

      expect((await listed()).slice(-3)).toEqual([
        ['Pizzeria Napoli Haninge', 'Mat & Dryck / Restaurang ?'],
        ['Kafferosteriet Bönan Vega', 'Mat & Dryck / Café & fika ?'],
        ['Mekaniker Lindqvist Verkstad', null],
      ]);
    });

    it('makes no guess with too few confirmed categories to learn from', async () => {
      await syncWith(
        transaction('Pizzeria Napoli Solna'),
        transaction('Kafferosteriet Bönan'),
        transaction('Pizzeria Napoli Haninge'),
      );
      await confirm('Pizzeria Napoli Solna', 'Mat & Dryck', 'Restaurang');
      await confirm('Kafferosteriet Bönan', 'Mat & Dryck', 'Café & fika');

      await syncWith(transaction('Pizzeria Napoli Vega'));

      expect((await listed()).slice(3)).toEqual([['Pizzeria Napoli Vega', null]]);
    });

    it('makes no guess when the words point to several subcategories', async () => {
      await confirmHistory();
      await syncWith(transaction('Pizzeria Kafferosteriet Mix'));

      expect((await listed()).slice(-1)).toEqual([['Pizzeria Kafferosteriet Mix', null]]);
    });

    it('uses the classifier only when history, keywords and the merchant code give nothing', async () => {
      await confirmHistory();

      await syncWith(
        transaction('Pizzeria Napoli Haninge', { mcc: '5411' }),
        transaction('Pizzeria Willys Solna'),
        transaction('Bageriet Vete Vega'),
      );

      expect((await listed()).slice(-3)).toEqual([
        ['Pizzeria Napoli Haninge', 'Mat & Dryck / Livsmedel ?'],
        ['Pizzeria Willys Solna', 'Mat & Dryck / Livsmedel ?'],
        ['Bageriet Vete Vega', 'Mat & Dryck / Café & fika ?'],
      ]);
    });

    it('learns from a new confirmation without a restart, and from confirmed categories only', async () => {
      await confirmHistory();
      await syncWith(transaction('Verkstan Bilbolaget Skruv'));
      expect((await listed()).at(-1)).toEqual(['Verkstan Bilbolaget Skruv', null]);

      // Guesses are not training data; only the owner's confirmation is.
      await confirm('Verkstan Bilbolaget Skruv', 'Transport', 'Bilpool & hyrbil');
      // A subcategory with few confirmations has a low prior, so it takes a dozen to be guessed.
      const places = ['Nord', 'Syd', 'Öst', 'Väst', 'Cityn', 'Hamn', 'Torg', 'Bro', 'Berg', 'Dal'];
      const more = [...places, 'Skog', 'Äng', 'Kulle', 'Sjö', 'Hed'].map((p) => `Bilbolaget ${p}`);
      await syncWith(...more.map((description) => transaction(description)));
      for (const description of more) await confirm(description, 'Transport', 'Bilpool & hyrbil');
      await syncWith(transaction('Bilbolaget Mitt'));

      expect((await listed()).at(-1)).toEqual([
        'Bilbolaget Mitt',
        'Transport / Bilpool & hyrbil ?',
      ]);
    });
  });
});

describe('guessing categories for the transactions already stored', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bankapp-guess-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function start(): Promise<INestApplication> {
    const app = await createApp({
      config: { ...testConfig, dataDir: dir },
      enableBanking: new FakeEnableBankingClient(),
      database: { dataDir: dir },
    });
    await app.init();
    return app;
  }

  function store(
    db: AppDatabase,
    description: string,
    raw = '{}',
    overrides: Partial<typeof transactions.$inferInsert> = {},
  ): void {
    db.insert(transactions)
      .values({
        accountId: 1,
        status: 'booked',
        amount: -100,
        currency: 'SEK',
        date: '2026-11-08',
        description,
        dedupKey: description,
        raw,
        fetchedAt: new Date('2026-11-10T12:00:00Z'),
        ...overrides,
      })
      .run();
  }

  const categories = async (app: INestApplication) =>
    (
      (await request(app.getHttpServer()).get('/api/transactions').expect(200))
        .body as TransactionsResponse
    ).transactions
      .map((t): [string, string | null] => [t.description, shown(t.category)])
      .sort(([a], [b]) => a.localeCompare(b));

  it('guesses them once, when the app first starts with guessing', async () => {
    // A database from before guessing: the backfill has run on it, but it was empty then.
    let app = await start();
    const db = app.get<AppDatabase>(DATABASE);
    db.insert(connections)
      .values({ bankName: 'Coop Mastercard', sessionId: 's', validUntil: new Date('2027-01-01') })
      .run();
    db.insert(accounts)
      .values({
        connectionId: 1,
        identificationHash: 'h',
        uid: 'u',
        name: 'Kort',
        type: 'card',
        currency: 'SEK',
      })
      .run();
    store(db, 'Willys Haninge');
    store(db, 'Trattoria', '{"merchant_category_code":"5812"}');
    store(db, 'Okänd');
    const alkohol = db.$client
      .prepare("SELECT id FROM subcategories WHERE name = 'Alkohol'")
      .get() as { id: number };
    store(db, 'ICA Nära Vega', '{}', { subcategoryId: alkohol.id, categoryConfirmed: true });
    db.$client.exec("DELETE FROM startup_tasks WHERE name = 'guess-existing-categories'");
    await app.close();

    app = await start();
    expect(await categories(app)).toEqual([
      ['ICA Nära Vega', 'Mat & Dryck / Alkohol'],
      ['Okänd', null],
      ['Trattoria', 'Mat & Dryck / Restaurang ?'],
      ['Willys Haninge', 'Mat & Dryck / Livsmedel ?'],
    ]);

    // Not again: what the owner made uncategorised stays so across restarts.
    const willys = (
      (await request(app.getHttpServer()).get('/api/transactions').expect(200))
        .body as TransactionsResponse
    ).transactions.find((t) => t.description === 'Willys Haninge')!;
    await request(app.getHttpServer())
      .put(`/api/transactions/${willys.id}/category`)
      .send({ subcategoryId: null })
      .expect(200);
    await app.close();

    app = await start();
    expect(await categories(app)).toContainEqual(['Willys Haninge', null]);
    await app.close();
  });
});
