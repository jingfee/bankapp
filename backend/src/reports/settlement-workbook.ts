import ExcelJS from 'exceljs';
import type { PartyNames, SettlementPeriod, ShareOption } from '@bankapp/shared';
import { partnerPossessive } from '../names/possessive';
import { roundOre } from '../transactions/owners-part';

const MONEY_FORMAT = '# ##0,00 "kr"';
const DATE_FORMAT = 'yyyy-MM-dd';
const DATETIME_FORMAT = 'yyyy-MM-dd HH:mm';

/** What each share option is called: Jag and Partner are the owner's and the partner's names. */
const shareNames = (names: PartyNames): Record<ShareOption, string> => ({
  me: names.owner,
  half: '50/50',
  household: 'Hushåll',
  partner: names.partner,
});

/** "Oktober 2026" for `2026-10`. */
export function monthTitle(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const name = new Intl.DateTimeFormat('sv-SE', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, number - 1, 1)),
  );
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

/** The report's path under the reports folder: `2026/2026-10 Avräkning oktober 2026.xlsx`. */
export function reportFileName(month: string): { dir: string; file: string } {
  const year = month.slice(0, 4);
  return { dir: year, file: `${month} Avräkning ${monthTitle(month).toLowerCase()}.xlsx` };
}

/** A calendar day as a real date, kept at UTC midnight so it shows as the same day everywhere. */
const day = (value: string) => new Date(`${value}T00:00:00Z`);

/** The settlement report of one closed period: summary, transactions and settlements. */
export async function buildSettlementWorkbook(
  period: SettlementPeriod,
  madeAt: Date,
  names: PartyNames,
): Promise<ExcelJS.Workbook> {
  const labels = shareNames(names);
  const partnersPart = `${partnerPossessive(names.partner)} andel`;
  const workbook = new ExcelJS.Workbook();
  workbook.created = madeAt;
  workbook.creator = 'Bankapp';

  const startsOn =
    period.startsOn ?? period.balanceSettings[0]?.asOf ?? period.items[0]?.date ?? null;
  const partnerPart = roundOre(period.items.reduce((sum, item) => sum + item.partnerPart, 0));

  const summary = workbook.addWorksheet('Sammanfattning');
  summary.columns = [{ width: 34 }, { width: 22 }];
  const addRow = (label: string, value: string | number | Date | null, format?: string) => {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { horizontal: 'right' };
    if (format) row.getCell(2).numFmt = format;
  };
  addRow('Månad', monthTitle(period.month));
  addRow('Första dag', startsOn === null ? null : day(startsOn), DATE_FORMAT);
  addRow(
    'Sista dag',
    period.closedThrough === null ? null : day(period.closedThrough),
    DATE_FORMAT,
  );
  addRow('Ingående saldo', period.carriedIn, MONEY_FORMAT);
  addRow(`${partnersPart} av perioden`, partnerPart, MONEY_FORMAT);
  addRow('Betalt genom avräkningar', period.paid, MONEY_FORMAT);
  addRow('Utgående saldo', period.carriedOut, MONEY_FORMAT);
  if (period.balanceSettings.length > 0) {
    summary.addRow([]);
    summary.addRow(['Saldoinställningar i perioden']).getCell(1).font = { bold: true };
    for (const setting of period.balanceSettings) {
      addRow(`Saldo per ${setting.asOf}`, setting.amount, MONEY_FORMAT);
    }
  }
  summary.addRow([]);
  addRow('Rapporten skapades', madeAt, DATETIME_FORMAT);

  const transactions = workbook.addWorksheet('Transaktioner');
  transactions.columns = [
    { header: 'Datum', width: 12, style: { numFmt: DATE_FORMAT } },
    { header: 'Beskrivning', width: 36 },
    { header: 'Konto', width: 20 },
    { header: 'Kategori', width: 34 },
    { header: 'Belopp', width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: 'Andel', width: 18 },
    { header: partnersPart, width: 18, style: { numFmt: MONEY_FORMAT } },
    { header: 'Betald av', width: 12 },
    { header: 'Status', width: 12 },
  ];
  for (const item of period.items) {
    transactions.addRow([
      day(item.date),
      item.description,
      item.accountName,
      item.category === null ? '' : `${item.category} › ${item.subcategory}`,
      item.amount,
      item.share === 'household'
        ? `${labels.household} (${item.ownerPercent}/${100 - item.ownerPercent})`
        : labels[item.share],
      item.partnerPart,
      item.paidBy === 'partner' ? names.partner : names.owner,
      item.status === 'booked' ? 'Bokförd' : 'Reserverad',
    ]);
  }
  addTotalsRow(transactions, 'Summa', {
    5: roundOre(period.items.reduce((sum, item) => sum + item.amount, 0)),
    7: partnerPart,
  });

  const payments = workbook.addWorksheet('Avräkningar');
  payments.columns = [
    { header: 'Datum', width: 12, style: { numFmt: DATE_FORMAT } },
    { header: 'Beskrivning', width: 36 },
    { header: 'Belopp', width: 16, style: { numFmt: MONEY_FORMAT } },
  ];
  for (const payment of period.payments) {
    payments.addRow([day(payment.date), payment.description, payment.amount]);
  }
  addTotalsRow(payments, 'Summa', { 3: period.paid });

  for (const sheet of [transactions, payments]) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  summary.getColumn(1).eachCell((cell) => (cell.alignment = { horizontal: 'left' }));
  return workbook;
}

function addTotalsRow(
  sheet: ExcelJS.Worksheet,
  label: string,
  totals: Record<number, number>,
): void {
  const row = sheet.addRow([]);
  const labelColumn = sheet.columns.findIndex((c) => c.header === 'Beskrivning') + 1;
  row.getCell(labelColumn).value = label;
  for (const [column, total] of Object.entries(totals)) row.getCell(Number(column)).value = total;
  row.font = { bold: true };
}
