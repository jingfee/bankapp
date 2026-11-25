import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CategoriesResponse, Transaction, TransactionDetails } from '@bankapp/shared';
import { of } from 'rxjs';
import { CategoriesService } from '../categories.service';
import { Offline } from '../offline/offline.service';
import { FakeSharesStore } from '../stores/shares.store.fake';
import { FakeTransactionsStore } from '../stores/transactions.store.fake';
import { SharesStore } from '../stores/shares.store';
import { TransactionsStore } from '../stores/transactions.store';
import { ManualTransactionSheet } from './manual-transaction-sheet';

const categories = {
  categories: [
    {
      id: 1,
      name: 'Mat',
      kind: 'expense',
      colour: 'green',
      icon: 'shopping-basket',
      fixed: false,
      subcategories: [{ id: 11, name: 'Livsmedel', icon: 'shopping-basket' }],
    },
    {
      id: 2,
      name: 'Inkomst',
      kind: 'income',
      colour: 'blue',
      icon: 'shopping-basket',
      fixed: true,
      subcategories: [{ id: 21, name: 'Lön', icon: 'shopping-basket' }],
    },
  ],
} as unknown as CategoriesResponse;

@Component({
  imports: [ManualTransactionSheet],
  template: `<button data-opener>Öppna</button>
    @if (open()) {
      <app-manual-transaction-sheet
        [transactionId]="id()"
        (saved)="saved.push($event)"
        (closed)="closed = closed + 1; open.set(false)"
      />
    }`,
})
class Host {
  readonly open = signal(true);
  readonly id = signal<string | null>(null);
  saved: Transaction[] = [];
  closed = 0;
}

describe('ManualTransactionSheet', () => {
  let transactionsStore: FakeTransactionsStore;
  let sharesStore: FakeSharesStore;
  const isOffline = signal(false);

  beforeEach(() => {
    isOffline.set(false);
    transactionsStore = new FakeTransactionsStore();
    sharesStore = new FakeSharesStore();
    sharesStore.subcategoryShares.set([{ subcategoryId: 11, share: 'half' }]);
  });

  /** What the fake transactions store was asked to do, by method. */
  const called = (method: string) => transactionsStore.calls.filter((c) => c.method === method);

  async function render(id: string | null = null, focusOpener = true) {
    TestBed.configureTestingModule({
      providers: [
        { provide: TransactionsStore, useValue: transactionsStore },
        { provide: SharesStore, useValue: sharesStore },
        { provide: CategoriesService, useValue: { list: () => of(categories.categories) } },
        { provide: Offline, useValue: { isOffline: isOffline.asReadonly() } },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.id.set(id);
    const opener = fixture.nativeElement.querySelector('[data-opener]') as HTMLButtonElement;
    document.body.append(fixture.nativeElement);
    if (focusOpener) opener.focus();
    fixture.detectChanges();
    await fixture.whenStable();
    return {
      fixture,
      host: fixture.componentInstance,
      page: document.body,
      opener,
    };
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  function fill(page: HTMLElement, selector: string, value: string) {
    const el = page.querySelector(selector) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  function click(page: HTMLElement, selector: string) {
    (page.querySelector(selector) as HTMLElement).click();
  }

  it('cannot be saved while offline, and can again when back online', async () => {
    const { fixture, page } = await render();
    const save = page.querySelector<HTMLButtonElement>('[data-save]')!;

    isOffline.set(true);
    await fixture.whenStable();
    expect(save.disabled).toBe(true);

    isOffline.set(false);
    await fixture.whenStable();
    expect(save.disabled).toBe(false);
  });

  it('stays open with what was entered when the save fails because the app went offline, and saves once back online', async () => {
    transactionsStore.failures['addManual'] = new HttpErrorResponse({ status: 0 });
    const { fixture, host, page } = await render();
    fill(page, '[data-description]', 'ICA Maxi');
    fill(page, '[data-amount]', '300,50');
    click(page, '[data-category-tile="1"]');
    await fixture.whenStable();
    click(page, '[data-subcategory="11"]');
    await fixture.whenStable();

    // The request that cannot reach the server is what makes the app offline (the interceptor).
    click(page, '[data-save]');
    isOffline.set(true);
    await fixture.whenStable();

    expect(host.closed).toBe(0);
    expect(page.querySelector('[data-sheet]')).not.toBeNull();
    expect(page.querySelector<HTMLInputElement>('[data-description]')!.value).toBe('ICA Maxi');
    expect(page.querySelector<HTMLInputElement>('[data-amount]')!.value).toBe('300,50');
    expect(page.querySelector('[data-subcategory="11"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(page.querySelector('[data-sheet]')!.textContent).toContain('Du är offline');
    expect(page.querySelector<HTMLButtonElement>('[data-save]')!.disabled).toBe(true);

    delete transactionsStore.failures['addManual'];
    transactionsStore.responses['addManual'] = { id: 9 };
    isOffline.set(false);
    await fixture.whenStable();
    click(page, '[data-save]');

    expect(called('addManual')).toHaveLength(2);
    expect(host.saved).toEqual([{ id: 9 }]);
  });

  it('adds an expense as a negative amount, dated today and inheriting the subcategory share', async () => {
    transactionsStore.responses['addManual'] = { id: 9 };
    const { fixture, host, page } = await render();
    expect(page.querySelector('[data-date] [data-date-text]')!.textContent!.trim()).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );

    fill(page, '[data-description]', 'ICA Maxi');
    fill(page, '[data-amount]', '300,50');
    click(page, '[data-category-tile="1"]');
    await fixture.whenStable();
    click(page, '[data-subcategory="11"]');
    await fixture.whenStable();
    // The subcategory's own share shows as chosen until the owner picks another.
    expect(page.querySelector('[data-share="half"]')?.getAttribute('aria-pressed')).toBe('true');
    click(page, '[data-save]');

    expect(called('addManual')).toHaveLength(1);
    expect(called('addManual')[0]!.args[0]).toMatchObject({
      description: 'ICA Maxi',
      amount: -300.5,
      subcategoryId: 11,
      share: null,
      paidBy: 'owner',
    });
    expect(host.saved).toEqual([{ id: 9 }]);
  });

  it('shows the validation message until amount, description and subcategory are filled in', async () => {
    const { fixture, page } = await render();
    click(page, '[data-save]');
    await fixture.whenStable();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'Fyll i belopp, beskrivning och underkategori.',
    );
    expect(called('addManual')).toEqual([]);
  });

  it('adds income as a positive amount from the income category, paid by the partner', async () => {
    transactionsStore.responses['addManual'] = { id: 9 };
    const { fixture, page } = await render();
    expect(page.querySelector('[data-category-tile="2"]')).toBeNull();
    click(page, '[data-kind="in"]');
    await fixture.whenStable();
    expect(page.querySelector('[data-category-tile="1"]')).toBeNull();
    fill(page, '[data-description]', 'Lön');
    fill(page, '[data-amount]', '100');
    click(page, '[data-category-tile="2"]');
    await fixture.whenStable();
    click(page, '[data-subcategory="21"]');
    click(page, '[data-share="partner"]');
    click(page, '[data-paid-by="partner"]');
    await fixture.whenStable();
    click(page, '[data-save]');
    expect(called('addManual')[0]!.args[0]).toMatchObject({
      amount: 100,
      subcategoryId: 21,
      share: 'partner',
      paidBy: 'partner',
    });
  });

  it('edits a manual transaction, starting from what it has', async () => {
    transactionsStore.responses['get'] = {
      id: 5,
      description: 'ICA Maxi',
      amount: { amount: -300.5, currency: 'SEK' },
      account: null,
      transactionDate: '2026-11-10',
      category: { subcategory: { id: 11 }, category: { id: 1 }, confirmed: true },
      share: { option: 'partner', percent: 100, source: 'transaction' },
      paidBy: 'partner',
    } as unknown as TransactionDetails;
    transactionsStore.responses['editManual'] = { id: 5 };
    const { host, page } = await render('5');

    expect((page.querySelector('[data-description]') as HTMLInputElement).value).toBe('ICA Maxi');
    expect((page.querySelector('[data-amount]') as HTMLInputElement).value).toBe('300,5');
    expect(page.querySelector('[data-date] [data-date-text]')!.textContent!.trim()).toBe(
      '2026-11-10',
    );
    fill(page, '[data-amount]', '350');
    click(page, '[data-save]');

    expect(called('get')[0]!.args).toEqual(['5']);
    expect(called('editManual')[0]!.args[0]).toBe(5);
    expect(called('editManual')[0]!.args[1]).toMatchObject({
      amount: -350,
      subcategoryId: 11,
      share: 'partner',
      paidBy: 'partner',
    });
    expect(host.saved.length).toBe(1);
  });

  it('keeps save disabled while the amount is not a number', async () => {
    const { fixture, page } = await render();
    const save = page.querySelector('[data-save]') as HTMLButtonElement;
    fill(page, '[data-amount]', '12,3,4');
    await fixture.whenStable();
    expect(save.disabled).toBe(true);
    fill(page, '[data-amount]', '12.5');
    await fixture.whenStable();
    expect(save.disabled).toBe(false);
  });

  it('shows nothing to save when the transaction cannot be found', async () => {
    transactionsStore.failures['get'] = new HttpErrorResponse({ status: 404 });
    const { page } = await render('5');
    expect(page.querySelector('[data-save]')).toBeNull();
  });

  it('shows the shares for as long as the sheet is open', async () => {
    const { fixture, host } = await render();
    expect(sharesStore.calls.map((c) => c.method)).toEqual(['activate']);
    host.open.set(false);
    fixture.detectChanges();
    expect(sharesStore.calls.map((c) => c.method)).toEqual(['activate', 'deactivate']);
  });

  it('does not edit a bank transaction', async () => {
    transactionsStore.responses['get'] = {
      id: 5,
      account: { id: 1, name: 'x', bank: 'y', type: 'payment' },
    } as unknown as TransactionDetails;
    const { page } = await render('5');
    expect(page.querySelector('[data-save]')).toBeNull();
  });

  it('closes with Escape and with the backdrop', async () => {
    const first = await render();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(first.host.closed).toBe(1);
    TestBed.resetTestingModule();
    document.body.replaceChildren();

    const second = await render();
    click(second.page, '[data-backdrop]');
    expect(second.host.closed).toBe(1);
  });

  it('keeps focus inside while open and returns it to the opener when closed', async () => {
    const { fixture, host, page, opener } = await render();
    const focusable = Array.from(
      page.querySelectorAll<HTMLElement>('[role="dialog"] button, [role="dialog"] input'),
    ).filter((el) => !(el as HTMLButtonElement).disabled);
    const dialog = page.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.contains(document.activeElement)).toBe(true);

    focusable.at(-1)!.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    focusable.at(-1)!.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);

    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    focusable[0]!.dispatchEvent(back);
    expect(document.activeElement).toBe(focusable.at(-1));

    host.open.set(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(opener);
  });
});
