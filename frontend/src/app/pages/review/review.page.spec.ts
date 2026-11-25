import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  Category,
  Transaction,
  TransactionCategory,
  TransactionReviewResponse,
} from '@bankapp/shared';
import { of } from 'rxjs';
import { CategoriesService } from '../../categories.service';
import { Offline } from '../../offline/offline.service';
import { TransactionsStore } from '../../stores/transactions.store';
import { FakeTransactionsStore } from '../../stores/transactions.store.fake';
import { ReviewPage } from './review.page';

describe('ReviewPage', () => {
  let store: FakeTransactionsStore;
  const isOffline = signal(false);

  beforeEach(() => {
    isOffline.set(false);
    store = new FakeTransactionsStore();
    TestBed.configureTestingModule({
      imports: [ReviewPage],
      providers: [
        { provide: TransactionsStore, useValue: store },
        { provide: CategoriesService, useValue: { list: () => of(categories) } },
        { provide: Offline, useValue: { isOffline: isOffline.asReadonly() } },
        provideRouter([]),
      ],
    });
  });

  const guess: TransactionCategory = {
    category: { id: 2, name: 'Mat & Dryck', colour: 'green' },
    subcategory: { id: 12, name: 'Livsmedel', icon: 'shopping-basket' },
    confirmed: false,
  };

  const transaction = (id: number, overrides: Partial<Transaction> = {}): Transaction => ({
    id,
    status: 'booked',
    amount: { amount: -10, currency: 'SEK' },
    date: '2026-11-10',
    description: `Köp ${id}`,
    account: { id: 7, name: 'Lönekonto', bank: 'Swedbank', type: 'payment' },
    category: null,
    share: { option: 'me', percent: 100, source: 'default' },
    ownerPart: -10,
    paidBy: 'owner',
    ...overrides,
  });

  const categories: Category[] = [
    {
      id: 2,
      name: 'Mat & Dryck',
      kind: 'expense',
      colour: 'green',
      icon: 'utensils',
      fixed: false,
      subcategories: [
        { id: 12, name: 'Livsmedel', icon: 'shopping-basket' },
        { id: 13, name: 'Restaurang', icon: 'utensils-crossed' },
      ],
    },
  ];

  type Body = Omit<TransactionReviewResponse, 'replacements'> &
    Partial<Pick<TransactionReviewResponse, 'replacements'>>;

  const answer = (body: Body): TransactionReviewResponse => ({ replacements: [], ...body });

  async function render(body: Body | 'error') {
    const fixture = TestBed.createComponent(ReviewPage);
    await fixture.whenStable();
    store.reviewAnswer.set(body === 'error' ? 'error' : answer(body));
    if (body !== 'error') store.reviewCount.set(body.count);
    await fixture.whenStable();
    return { fixture, page: fixture.nativeElement as HTMLElement };
  }

  /** What the store does after a mutation: the `transactions` fact refreshes the read and the count. */
  async function refreshed(fixture: { whenStable: () => Promise<unknown> }, body: Body) {
    store.reviewAnswer.set(answer(body));
    store.reviewCount.set(body.count);
    await fixture.whenStable();
  }

  const calls = (method: string) => store.calls.filter((c) => c.method === method);
  const saved = { category: { ...guess, confirmed: true }, updatedSimilar: 0, others: [] };

  /** Ids of the rows still open; a row collapsing away after being handled does not count. */
  const ids = (root: ParentNode) =>
    Array.from(root.querySelectorAll('li[data-transaction]:not([data-leaving])')).map((li) =>
      li.getAttribute('data-id'),
    );

  it('lists guesses before uncategorised transactions in one Bekräfta kategori section', async () => {
    const { page } = await render({
      count: 4,
      transactions: [
        transaction(4, { category: guess }),
        transaction(3),
        transaction(2, { category: guess }),
        transaction(1),
      ],
    });

    const section = page.querySelector('section[data-categories]') as HTMLElement;
    expect(section.querySelector('h2')?.textContent?.trim()).toBe('Bekräfta kategori');
    expect(section.querySelector('[data-section-count]')?.textContent?.trim()).toBe(
      '4 gissade eller okategoriserade',
    );
    expect(ids(section)).toEqual(['4', '2', '3', '1']);
  });

  it('disables every change while offline, keeps reading open, and enables them again when back online', async () => {
    const { fixture, page } = await render({
      count: 2,
      transactions: [transaction(2, { category: guess }), transaction(1)],
      replacements: [{ manual: transaction(8), bank: transaction(9) }],
    });
    const changes = () =>
      Array.from(
        page.querySelectorAll<HTMLButtonElement>(
          '[data-confirm], [data-change], [data-replace], [data-not-same]',
        ),
      );
    expect(changes()).toHaveLength(5);
    expect(changes().every((button) => !button.disabled)).toBe(true);

    isOffline.set(true);
    await fixture.whenStable();
    expect(changes().every((button) => button.disabled)).toBe(true);
    changes()[0]!.click();
    expect(calls('setCategory')).toHaveLength(0);
    // Reading stays possible: the rows still link to their details.
    expect(page.querySelector('li[data-id="2"] a[href="/transaktioner/2"]')).not.toBeNull();

    isOffline.set(false);
    await fixture.whenStable();
    expect(changes().every((button) => !button.disabled)).toBe(true);
  });

  it('says the app is offline, not a generic error, when a save fails because it went offline', async () => {
    store.failures['setCategory'] = new HttpErrorResponse({ status: 0 });
    const { fixture, page } = await render({
      count: 1,
      transactions: [transaction(2, { category: guess })],
    });

    (page.querySelector('li[data-id="2"] [data-confirm]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(page.textContent).toContain('Du är offline');
    expect(page.textContent).not.toContain('Försök igen.');
  });

  it('shows a skeleton while the review is being read', async () => {
    const fixture = TestBed.createComponent(ReviewPage);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('labels the guess, or says there is none', async () => {
    const { page } = await render({
      count: 2,
      transactions: [transaction(2, { category: guess }), transaction(1)],
    });

    expect(page.querySelector('li[data-id="2"] [data-guess-tag]')?.textContent?.trim()).toBe(
      'Gissad: Livsmedel',
    );
    expect(page.querySelector('li[data-id="2"] [data-guess-tag] [data-guess-mark]')).toBeNull();
    expect(page.querySelector('li[data-id="1"] [data-guess-tag]')?.textContent?.trim()).toBe(
      'Ingen gissning',
    );
    expect(page.querySelector('li[data-id="2"] [data-change]')?.textContent?.trim()).toBe('Ändra');
    expect(page.querySelector('li[data-id="1"] [data-change]')?.textContent?.trim()).toBe(
      'Välj kategori',
    );
  });

  it('says how many are left and how far along the visit is', async () => {
    const { fixture, page } = await render({
      count: 4,
      transactions: [
        transaction(4, { category: guess }),
        transaction(3, { category: guess }),
        transaction(2),
        transaction(1),
      ],
    });
    const bar = () => page.querySelector('[data-progress]') as HTMLElement;

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Att granska');
    expect(page.querySelector('[data-remaining]')?.textContent?.trim()).toBe('4 kvar att bekräfta');
    expect(bar().getAttribute('aria-valuenow')).toBe('0');
    expect(bar().getAttribute('aria-valuemax')).toBe('4');

    store.responses['setCategory'] = saved;
    (page.querySelector('li[data-id="4"] [data-confirm]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(page.querySelector('[data-remaining]')?.textContent?.trim()).toBe('3 kvar att bekräfta');
    expect(bar().getAttribute('aria-valuenow')).toBe('1');
    expect(bar().getAttribute('aria-valuemax')).toBe('4');
  });

  describe('long lists', () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => transaction(13 - i));

    it('shows the first 5 and a Visa alla button, and keeps 5 showing as rows are confirmed', async () => {
      const { fixture, page } = await render({ count: 13, transactions: thirteen });
      expect(ids(page)).toEqual(['13', '12', '11', '10', '9']);
      expect(page.querySelector('[data-show-all]')?.textContent?.trim()).toBe('Visa alla 13');

      (page.querySelector('li[data-id="13"] [data-change]') as HTMLButtonElement).click();
      await fixture.whenStable();
      (
        page.querySelector('li[data-id="13"] [data-category-tile="2"]') as HTMLButtonElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();
      store.responses['setCategory'] = saved;
      (page.querySelector('li[data-id="13"] [data-subcategory="13"]') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(ids(page)).toEqual(['12', '11', '10', '9', '8']);
      expect(page.querySelector('[data-show-all]')?.textContent?.trim()).toBe('Visa alla 12');
    });

    it('shows every row after Visa alla', async () => {
      const { fixture, page } = await render({ count: 13, transactions: thirteen });

      (page.querySelector('[data-show-all]') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(ids(page)).toHaveLength(13);
      expect(page.querySelector('[data-show-all]')).toBeNull();
    });
  });

  it('collapses a confirmed row away before removing it, even once the store has dropped it', async () => {
    const { fixture, page } = await render({
      count: 1,
      transactions: [transaction(1, { category: guess })],
    });
    vi.useFakeTimers();
    try {
      store.responses['setCategory'] = saved;
      (page.querySelector('[data-confirm]') as HTMLButtonElement).click();
      store.reviewAnswer.set(answer({ count: 0, transactions: [] }));
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      expect(page.querySelector('li[data-id="1"]')?.hasAttribute('data-leaving')).toBe(true);

      await vi.advanceTimersByTimeAsync(500);
      fixture.detectChanges();
      expect(page.querySelector('li[data-id="1"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers one-tap confirm on guesses only', async () => {
    const { page } = await render({
      count: 2,
      transactions: [transaction(2, { category: guess }), transaction(1)],
    });

    expect(page.querySelector('li[data-id="2"] [data-confirm]')).not.toBeNull();
    expect(page.querySelector('li[data-id="1"] [data-confirm]')).toBeNull();
  });

  it('confirms a guess with one tap, and the row and the header count follow the store', async () => {
    const { fixture, page } = await render({
      count: 2,
      transactions: [transaction(2, { category: guess }), transaction(1)],
    });
    expect(store.reviewCount()).toBe(2);

    store.responses['setCategory'] = saved;
    (page.querySelector('li[data-id="2"] [data-confirm]') as HTMLButtonElement).click();
    expect(calls('setCategory')).toEqual([{ method: 'setCategory', args: [2, 12] }]);
    await refreshed(fixture, { count: 1, transactions: [transaction(1)] });

    expect(ids(page)).toEqual(['1']);
    expect(page.querySelector('[data-remaining]')?.textContent?.trim()).toBe('1 kvar att bekräfta');
    expect(store.reviewCount()).toBe(1);
  });

  it('asks for the review once, and never refreshes it or the count itself', async () => {
    const { fixture, page } = await render({
      count: 1,
      transactions: [transaction(1, { category: guess })],
    });

    store.responses['setCategory'] = { ...saved, updatedSimilar: 1 };
    (page.querySelector('[data-confirm]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(store.reviewReads).toBe(1);
    expect(calls('refreshReviewCount')).toEqual([]);
  });

  it('says how many similar transactions were updated, and shows their new guess', async () => {
    const { fixture, page } = await render({
      count: 3,
      transactions: [
        transaction(3, { category: guess }),
        transaction(2, { category: guess }),
        transaction(1),
      ],
    });

    store.responses['setCategory'] = { ...saved, updatedSimilar: 2 };
    (page.querySelector('li[data-id="3"] [data-confirm]') as HTMLButtonElement).click();
    await refreshed(fixture, {
      count: 2,
      transactions: [transaction(2, { category: guess }), transaction(1, { category: guess })],
    });
    fixture.detectChanges();

    expect(page.querySelector('[data-similar-updated]')?.textContent?.trim()).toBe(
      '2 liknande transaktioner uppdaterades',
    );
    expect(ids(page)).toEqual(['2', '1']);
  });

  it('sets a category from the inline picker, for a guess as well as an uncategorised row', async () => {
    const { fixture, page } = await render({
      count: 2,
      transactions: [transaction(2, { category: guess }), transaction(1)],
    });

    (page.querySelector('li[data-id="1"] [data-change]') as HTMLButtonElement).click();
    await fixture.whenStable();
    (page.querySelector('li[data-id="1"] [data-category-tile="2"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    store.responses['setCategory'] = saved;
    (page.querySelector('li[data-id="1"] [data-subcategory="13"]') as HTMLButtonElement).click();
    expect(calls('setCategory')).toEqual([{ method: 'setCategory', args: [1, 13] }]);
    await refreshed(fixture, { count: 1, transactions: [transaction(2, { category: guess })] });
    expect(ids(page)).toEqual(['2']);

    (page.querySelector('li[data-id="2"] [data-change]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(page.querySelector('li[data-id="2"] [data-picker]')).not.toBeNull();
    (page.querySelector('li[data-id="2"] [data-subcategory="13"]') as HTMLButtonElement).click();
    await refreshed(fixture, { count: 0, transactions: [] });
    expect(calls('setCategory')[1]).toEqual({ method: 'setCategory', args: [2, 13] });
    expect(ids(page)).toEqual([]);
  });

  it('preselects the guessed category and marks its subcategory as current', async () => {
    const { fixture, page } = await render({
      count: 1,
      transactions: [transaction(2, { category: guess })],
    });
    (page.querySelector('li[data-id="2"] [data-change]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      page.querySelector('li[data-id="2"] [data-category-tile="2"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      page.querySelector('li[data-id="2"] [data-subcategory="12"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      page.querySelector('li[data-id="2"] [data-subcategory="13"]')?.getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('searches subcategories by name, and shows a whole category for its name', async () => {
    const { fixture, page } = await render({
      count: 1,
      transactions: [transaction(1)],
    });
    (page.querySelector('li[data-id="1"] [data-change]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const search = async (query: string) => {
      const input = page.querySelector(
        'li[data-id="1"] [data-category-search]',
      ) as HTMLInputElement;
      input.value = query;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      fixture.detectChanges();
      return Array.from(page.querySelectorAll('li[data-id="1"] [data-subcategory]')).map((e) =>
        e.getAttribute('data-subcategory'),
      );
    };

    expect(await search('REST')).toEqual(['13']);
    expect(await search('mat')).toEqual(['12', '13']);
    expect(await search('zzz')).toEqual([]);
    expect(page.querySelector('[data-picker-empty]')).not.toBeNull();
    expect(await search('')).toEqual([]);
    expect(page.querySelector('li[data-id="1"] [data-category-tile="2"]')).not.toBeNull();
  });

  it('keeps the row and says so when saving fails', async () => {
    const { fixture, page } = await render({
      count: 1,
      transactions: [transaction(2, { category: guess })],
    });

    store.failures['setCategory'] = new Error('offline');
    (page.querySelector('[data-confirm]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(ids(page)).toEqual(['2']);
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('kunde inte sparas');
  });

  it('celebrates when nothing is left to review, with a way back to the overview', async () => {
    const { page } = await render({ count: 0, transactions: [] });

    expect(page.querySelector('[data-empty]')?.textContent).toContain('Allt är granskat');
    expect(page.querySelector('[data-empty] a')?.getAttribute('href')).toBe('/');
    expect(page.querySelector('[data-empty] a')?.textContent?.trim()).toBe('Till översikten');
    expect(page.querySelector('[data-progress]')).toBeNull();
  });

  describe('suggested replacements', () => {
    const pair = {
      manual: transaction(1, {
        description: 'Coop',
        amount: { amount: -245, currency: 'SEK' },
        account: null,
        category: { ...guess, confirmed: true },
      }),
      bank: transaction(2, {
        description: 'COOP KONSUM',
        amount: { amount: -247.5, currency: 'SEK' },
      }),
    };

    it('shows both rows with Ersätt med banktransaktionen and Inte samma', async () => {
      const { page } = await render({ count: 1, transactions: [], replacements: [pair] });

      const rows = Array.from(page.querySelectorAll('[data-replacement-row]')).map((row) =>
        row.textContent?.replace(/\s+/g, ' ').trim(),
      );
      expect(rows[0]).toContain('Coop');
      expect(rows[0]).toContain('Manuell');
      expect(rows[1]).toContain('COOP KONSUM');
      expect(page.querySelector('[data-replace]')?.textContent?.trim()).toBe(
        'Ersätt med banktransaktionen',
      );
      expect(page.querySelector('[data-not-same]')?.textContent?.trim()).toBe('Inte samma');
      expect(page.querySelector('[data-empty]')).toBeNull();
      expect(page.querySelector('[data-section-count]')?.textContent?.trim()).toBe(
        '1 förslag · en manuell transaktion som verkar ha kommit från banken',
      );
      expect(page.querySelector('[data-remaining]')?.textContent?.trim()).toBe(
        '1 kvar att bekräfta',
      );
    });

    it('leaves the section out when there are no suggestions', async () => {
      const { page } = await render({ count: 1, transactions: [transaction(1)] });
      expect(page.querySelector('[data-replacements]')).toBeNull();
    });

    it('replaces the manual transaction, and the pair and the count follow the store', async () => {
      const { fixture, page } = await render({
        count: 1,
        transactions: [],
        replacements: [pair],
      });

      (page.querySelector('[data-replace]') as HTMLButtonElement).click();
      expect(calls('replace')).toEqual([{ method: 'replace', args: [{ manualId: 1, bankId: 2 }] }]);
      await refreshed(fixture, { count: 0, transactions: [], replacements: [] });

      expect(page.querySelector('[data-replacement]:not([data-leaving])')).toBeNull();
      expect(page.querySelector('[data-replacement]')?.hasAttribute('data-leaving')).toBe(true);
      expect(page.querySelector('[data-remaining]')).toBeNull();
      expect(store.reviewCount()).toBe(0);
    });

    it('stores Inte samma and drops the pair', async () => {
      const { fixture, page } = await render({
        count: 1,
        transactions: [],
        replacements: [pair],
      });

      (page.querySelector('[data-not-same]') as HTMLButtonElement).click();
      expect(calls('notSame')).toEqual([{ method: 'notSame', args: [{ manualId: 1, bankId: 2 }] }]);
      await refreshed(fixture, { count: 0, transactions: [], replacements: [] });

      expect(page.querySelector('[data-replacement]:not([data-leaving])')).toBeNull();
    });

    it('keeps the pair and says so when saving fails', async () => {
      const { fixture, page } = await render({
        count: 1,
        transactions: [],
        replacements: [pair],
      });

      store.failures['replace'] = new Error('offline');
      (page.querySelector('[data-replace]') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(page.querySelector('[data-replacement]')).not.toBeNull();
      expect(page.querySelector('[role="alert"]')?.textContent).toContain(
        'Det gick inte att spara',
      );
    });
  });

  it('says so when the list cannot be fetched', async () => {
    const { page } = await render('error');

    expect(page.querySelector('[role="alert"]')?.textContent).toContain('kunde inte hämtas');
  });
});
