import type { INestApplication } from '@nestjs/common';
import type { CategoriesResponse, SettlementResponse } from '@bankapp/shared';
import ExcelJS from 'exceljs';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db/database';
import { DATABASE } from '../src/db/database.module';
import { accounts, connections, transactions } from '../src/db/schema';
import { FakeEnableBankingClient, testConfig, api } from './support';

const REPORT = '2026-10 Avräkning oktober 2026.xlsx';

describe('the settlement report', () => {
  let app: INestApplication;
  let db: AppDatabase;
  let reportsDir: string;
  let subcategoryIds: Map<string, number>;
  let counter = 0;

  beforeEach(async () => {
    reportsDir = mkdtempSync(join(tmpdir(), 'bankapp-report-test-'));
    app = await createApp({
      config: { ...testConfig, reportsDir, ownerName: 'Kim', partnerName: 'Robin' },
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
      now: () => new Date('2026-11-15T12:00:00'),
    });
    await app.init();
    db = app.get<AppDatabase>(DATABASE);
    db.insert(connections)
      .values({ bankName: 'Swedbank', sessionId: 's', validUntil: new Date('2027-06-01') })
      .run();
    db.insert(accounts)
      .values({
        connectionId: 1,
        identificationHash: 'h',
        uid: 'u',
        name: 'Coop Mastercard',
        type: 'card',
        currency: 'SEK',
        share: 'half',
      })
      .run();
    const body = (await api(app).get('/api/categories').expect(200)).body as CategoriesResponse;
    subcategoryIds = new Map(
      body.categories.flatMap((c) => c.subcategories).map((s) => [s.name, s.id]),
    );
  });

  afterEach(async () => {
    await app.close();
    rmSync(reportsDir, { recursive: true, force: true });
  });

  function store(amount: number, date: string, values: Partial<typeof transactions.$inferInsert>) {
    counter += 1;
    db.insert(transactions)
      .values({
        accountId: 1,
        status: 'booked',
        amount,
        currency: 'SEK',
        date,
        description: `Köp ${counter}`,
        dedupKey: `k${counter}`,
        raw: '{}',
        fetchedAt: new Date('2026-11-10T12:00:00Z'),
        ...values,
      })
      .run();
  }
  const inCategory = (name: string) => ({
    subcategoryId: subcategoryIds.get(name)!,
    categoryConfirmed: true,
  });

  const close = (closedThrough = '2026-10-31', nextMonth = '2026-11') =>
    api(app).post('/api/settlement/close').send({ closedThrough, nextMonth });
  const file = () => join(reportsDir, '2026', REPORT);

  /** Opens October with a balance of 100 kr, a 50/50 purchase, a pending one and a settlement. */
  async function fillOctober() {
    await api(app)
      .post('/api/settlement/balance-settings')
      .send({ amount: 100, asOf: '2026-10-01' })
      .expect(201);
    await api(app).put('/api/settlement/month').send({ month: '2026-10' }).expect(200);
    store(-1000, '2026-10-05', { description: 'ICA', ...inCategory('Livsmedel') });
    store(-500, '2026-10-12', { status: 'pending', description: 'Biograf' });
    store(300, '2026-10-20', { description: 'Swish', ...inCategory('Avräkning delade utgifter') });
  }

  async function read(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file());
    return workbook;
  }

  it('is written when a month closes, with three sheets that match the Delat page', async () => {
    await fillOctober();
    const closed = (await close().expect(201)).body as SettlementResponse;
    const period = closed.periods.find((p) => p.month === '2026-10')!;
    expect(period.reportSaved).toBe(true);

    const workbook = await read();
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      'Sammanfattning',
      'Transaktioner',
      'Avräkningar',
    ]);

    const summary = workbook.getWorksheet('Sammanfattning')!;
    const values = new Map(
      summary.getSheetValues().flatMap((row) => {
        const [, label, value] = (row ?? []) as unknown[];
        return typeof label === 'string' ? [[label, value]] : [];
      }),
    );
    expect(values.get('Månad')).toBe('Oktober 2026');
    expect(values.get('Sista dag')).toEqual(new Date('2026-10-31T00:00:00Z'));
    expect(values.get('Ingående saldo')).toBe(period.carriedIn);
    expect(values.get('Utgående saldo')).toBe(period.carriedOut);
    expect(values.get('Betalt genom avräkningar')).toBe(300);
    expect(values.get('Robins andel av perioden')).toBe(750);

    const rows = workbook.getWorksheet('Transaktioner')!;
    expect(rows.rowCount).toBe(1 + period.items.length + 1);
    const first = rows.getRow(2);
    expect(first.getCell(1).value).toEqual(new Date('2026-10-05T00:00:00Z'));
    expect(first.getCell(1).numFmt).toBe('yyyy-MM-dd');
    expect(first.getCell(2).value).toBe('ICA');
    expect(first.getCell(3).value).toBe('Coop Mastercard');
    expect(first.getCell(4).value).toBe('Mat & Dryck › Livsmedel');
    expect(first.getCell(5).value).toBe(-1000);
    expect(first.getCell(5).numFmt).toBe('# ##0,00 "kr"');
    expect(first.getCell(6).value).toBe('50/50');
    expect(first.getCell(7).value).toBe(500);
    expect(first.getCell(8).value).toBe('Kim');
    expect(rows.getRow(1).getCell(7).value).toBe('Robins andel');
    expect(first.getCell(9).value).toBe('Bokförd');
    expect(rows.getRow(3).getCell(9).value).toBe('Reserverad');
    const totals = rows.getRow(rows.rowCount);
    expect(totals.getCell(5).value).toBe(-1500);
    expect(totals.getCell(7).value).toBe(750);
    expect(rows.getRow(1).font?.bold).toBe(true);
    expect(rows.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });

    const payments = workbook.getWorksheet('Avräkningar')!;
    expect(payments.getRow(2).getCell(2).value).toBe('Swish');
    expect(payments.getRow(2).getCell(3).value).toBe(300);
    expect(payments.getRow(3).getCell(3).value).toBe(300);
  });

  it('is saved nowhere else than the year folder and leaves no partial file', async () => {
    await fillOctober();
    await close().expect(201);
    expect(readdirSync(reportsDir)).toEqual(['2026']);
    expect(readdirSync(join(reportsDir, '2026'))).toEqual([REPORT]);
    expect(statSync(file()).mode & 0o077).toBe(0);
  });

  it('does not stop the close when it cannot be saved, and can be saved again', async () => {
    await fillOctober();
    writeFileSync(join(reportsDir, '2026'), 'in the way');
    const closed = (await close().expect(201)).body as SettlementResponse;
    const period = closed.periods.find((p) => p.month === '2026-10')!;
    expect(period.closedThrough).toBe('2026-10-31');
    expect(period.reportSaved).toBe(false);

    await api(app).post('/api/settlement/periods/2026-10/report').expect(500);
    rmSync(join(reportsDir, '2026'));
    const again = (await api(app).post('/api/settlement/periods/2026-10/report').expect(201))
      .body as SettlementResponse;
    expect(again.periods.find((p) => p.month === '2026-10')!.reportSaved).toBe(true);
    expect(existsSync(file())).toBe(true);
  });

  it('is replaced with the current figures when saved again', async () => {
    await fillOctober();
    await close().expect(201);
    store(-200, '2026-10-25', { description: 'Sen bokning', ...inCategory('Livsmedel') });
    await api(app).post('/api/settlement/periods/2026-10/report').expect(201);
    const rows = (await read()).getWorksheet('Transaktioner')!;
    expect(rows.rowCount).toBe(1 + 3 + 1);
    expect(rows.getRow(rows.rowCount).getCell(5).value).toBe(-1700);
  });

  it('has no report to save again for the open period or an unknown month', async () => {
    await fillOctober();
    await close().expect(201);
    await api(app).post('/api/settlement/periods/2026-11/report').expect(404);
    await api(app).post('/api/settlement/periods/1999-01/report').expect(404);
  });

  it('is deleted when the close is undone, and written anew by the next close', async () => {
    await fillOctober();
    await close().expect(201);
    expect(existsSync(file())).toBe(true);
    await api(app).post('/api/settlement/undo-close').expect(201);
    expect(existsSync(file())).toBe(false);
    await close().expect(201);
    expect(existsSync(file())).toBe(true);
  });
});
