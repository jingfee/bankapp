import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CategoriesResponse, Transaction, TransactionDetails } from '@bankapp/shared';
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
  async function render(id: string | null = null, focusOpener = true) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.id.set(id);
    const opener = fixture.nativeElement.querySelector('[data-opener]') as HTMLButtonElement;
    document.body.append(fixture.nativeElement);
    if (focusOpener) opener.focus();
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/categories').flush(categories);
    http
      .expectOne('/api/subcategory-shares')
      .flush({ shares: [{ subcategoryId: 11, share: 'half' }] });
    await fixture.whenStable();
    return {
      fixture,
      host: fixture.componentInstance,
      page: document.body,
      http,
      opener,
    };
  }

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
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

  it('adds an expense as a negative amount, dated today and inheriting the subcategory share', async () => {
    const { fixture, host, page, http } = await render();
    expect((page.querySelector('[data-date]') as HTMLInputElement).value).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );

    fill(page, '[data-description]', 'ICA Maxi');
    fill(page, '[data-amount]', '300');
    click(page, '[data-category-tile="1"]');
    await fixture.whenStable();
    click(page, '[data-subcategory="11"]');
    await fixture.whenStable();
    // The subcategory's own share shows as chosen until the owner picks another.
    expect(page.querySelector('[data-share="half"]')?.getAttribute('aria-pressed')).toBe('true');
    click(page, '[data-save]');

    const request = http.expectOne('/api/transactions');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({
      description: 'ICA Maxi',
      amount: -300,
      subcategoryId: 11,
      share: null,
      paidBy: 'owner',
    });
    request.flush({ id: 9 });
    expect(host.saved).toEqual([{ id: 9 }]);
  });

  it('shows the validation message until amount, description and subcategory are filled in', async () => {
    const { fixture, page, http } = await render();
    click(page, '[data-save]');
    await fixture.whenStable();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'Fyll i belopp, beskrivning och underkategori.',
    );
    http.expectNone('/api/transactions');
  });

  it('adds income as a positive amount from the income category, paid by the partner', async () => {
    const { fixture, page, http } = await render();
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
    const request = http.expectOne('/api/transactions');
    expect(request.request.body).toMatchObject({
      amount: 100,
      subcategoryId: 21,
      share: 'partner',
      paidBy: 'partner',
    });
    request.flush({ id: 9 });
  });

  it('edits a manual transaction, starting from what it has', async () => {
    const { fixture, host, page, http } = await render('5');
    http.expectOne('/api/transactions/5').flush({
      id: 5,
      description: 'ICA Maxi',
      amount: { amount: -300, currency: 'SEK' },
      account: null,
      transactionDate: '2026-11-10',
      category: { subcategory: { id: 11 }, category: { id: 1 }, confirmed: true },
      share: { option: 'partner', percent: 100, source: 'transaction' },
      paidBy: 'partner',
    } as unknown as TransactionDetails);
    await fixture.whenStable();

    expect((page.querySelector('[data-description]') as HTMLInputElement).value).toBe('ICA Maxi');
    expect((page.querySelector('[data-amount]') as HTMLInputElement).value).toBe('300');
    expect((page.querySelector('[data-date]') as HTMLInputElement).value).toBe('2026-11-10');
    fill(page, '[data-amount]', '350');
    click(page, '[data-save]');

    const request = http.expectOne('/api/transactions/5');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toMatchObject({
      amount: -350,
      subcategoryId: 11,
      share: 'partner',
      paidBy: 'partner',
    });
    request.flush({ id: 5 });
    expect(host.saved.length).toBe(1);
  });

  it('does not edit a bank transaction', async () => {
    const { fixture, page, http } = await render('5');
    http.expectOne('/api/transactions/5').flush({
      id: 5,
      account: { id: 1, name: 'x', bank: 'y', type: 'payment' },
    } as unknown as TransactionDetails);
    await fixture.whenStable();
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
