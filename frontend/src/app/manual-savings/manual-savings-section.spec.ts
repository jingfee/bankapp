import { TestBed } from '@angular/core/testing';
import type { ManualSavingsAccount } from '@bankapp/shared';
import { FakeSavingsStore } from '../stores/savings.store.fake';
import { SavingsStore } from '../stores/savings.store';
import { ManualSavingsSection } from './manual-savings-section';

const ISK: ManualSavingsAccount = {
  id: 7,
  name: 'Avanza ISK',
  institution: 'Avanza',
  closedOn: null,
  entries: [
    { id: 2, date: '2025-11-27', balance: 409500, netDeposits: 305000 },
    { id: 1, date: '2025-10-28', balance: 400000, netDeposits: null },
  ],
  balance: 409500,
  netDeposits: 305000,
  growth: 104500,
  growthApproximate: true,
};

describe('ManualSavingsSection', () => {
  let store: FakeSavingsStore;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00'));
    store = new FakeSavingsStore();
    TestBed.configureTestingModule({ providers: [{ provide: SavingsStore, useValue: store }] });
  });
  afterEach(() => vi.useRealTimers());

  /** What the section sent to the store for a mutation, in order. */
  const sent = (method: string) =>
    store.calls.filter((c) => c.method === method).map((c) => c.args);

  async function render(accounts: ManualSavingsAccount[] = [ISK]) {
    const fixture = TestBed.createComponent(ManualSavingsSection);
    store.manualSavingsAnswer.set({ accounts });
    await fixture.whenStable();
    // Sheets and confirmations open in <body>, outside the section.
    const root = document.body;
    const click = async (selector: string) => {
      root.querySelector<HTMLElement>(selector)!.click();
      await fixture.whenStable();
    };
    const type = async (selector: string, text: string) => {
      const input = root.querySelector<HTMLInputElement>(selector)!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    /** Opens the ⋯ menu of the first element matching `scope`. */
    const openMenu = (scope: string) => click(`${scope} [data-menu-trigger]`);
    return { fixture, root, click, type, openMenu };
  }

  it('lists accounts with their entries newest first, leaving the figures to the Sparande page', async () => {
    const { root } = await render();
    expect(root.querySelector('[data-manual-name]')?.textContent).toContain('Avanza ISK');
    expect(root.querySelector('[data-growth]')).toBeNull();
    const days = Array.from(root.querySelectorAll('[data-entry-day]')).map((d) => d.textContent);
    expect(days).toEqual(['27 nov 2025', '28 okt 2025']);
  });

  it('sends a new entry with Swedish-format amounts and leaves blank net deposits null', async () => {
    const { root, click, type } = await render();
    await click('[data-new-entry]');
    expect(root.textContent).toContain('Som det står hos banken');
    await type('[data-entry-balance]', '410 000,50');
    await click('[data-save-entry]');
    const [id, request] = sent('addEntry')[0] as [number, { date: string }];
    expect(id).toBe(7);
    expect(request).toMatchObject({ balance: 410000.5, netDeposits: null });
    expect(request.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sends net deposits when given', async () => {
    const { click, type } = await render();
    await click('[data-new-entry]');
    await type('[data-entry-balance]', '1000');
    await type('[data-entry-deposits]', '900,5');
    await click('[data-save-entry]');
    expect(sent('addEntry')[0]![1]).toMatchObject({ balance: 1000, netDeposits: 900.5 });
  });

  it('refuses a missing or non-numeric balance without calling the server', async () => {
    const { root, click, type } = await render();
    await click('[data-new-entry]');
    await click('[data-save-entry]');
    expect(root.querySelector('[data-entry-error]')).not.toBeNull();
    await type('[data-entry-balance]', 'abc');
    await click('[data-save-entry]');
    expect(root.querySelector('[data-entry-error]')).not.toBeNull();
    await type('[data-entry-balance]', '100');
    await type('[data-entry-deposits]', 'x');
    await click('[data-save-entry]');
    expect(root.querySelector('[data-entry-error]')?.textContent).toContain('insatt');
  });

  it('corrects an entry in place, prefilled', async () => {
    const { root, click, type, openMenu } = await render();
    await openMenu('[data-entry]');
    await click('[data-edit-entry]');
    expect(root.querySelector<HTMLInputElement>('[data-entry-balance]')!.value).toBe('409500');
    expect(root.querySelector<HTMLInputElement>('[data-entry-deposits]')!.value).toBe('305000');
    await type('[data-entry-balance]', '409600');
    await click('[data-save-entry]');
    expect(sent('updateEntry')[0]).toMatchObject([7, 2, { date: '2025-11-27', balance: 409600 }]);
  });

  it('says so when a day already has an entry', async () => {
    const { fixture, root, click, type, openMenu } = await render();
    store.failures['updateEntry'] = { status: 409 };
    await openMenu('[data-entry]');
    await click('[data-edit-entry]');
    await type('[data-entry-balance]', '1');
    await click('[data-save-entry]');
    await fixture.whenStable();
    expect(root.querySelector('[data-entry-error]')?.textContent).toContain('redan');
  });

  it('adds an account with a name and optional institution', async () => {
    const { click, type } = await render([]);
    await click('[data-open-add-account]');
    store.responses['create'] = { ...ISK, entries: [], balance: null };
    await type('[data-account-name-input]', 'Avanza ISK');
    await click('[data-save-account]');
    expect(sent('create')).toEqual([[{ name: 'Avanza ISK', institution: null }]]);
  });

  it('closes an account on a date and reopens a closed one', async () => {
    const { fixture, root, click, openMenu } = await render();
    await openMenu('[data-manual-account]');
    await click('[data-close]');
    await click('[data-confirm-close]');
    const [id, request] = sent('close')[0] as [number, { date: string }];
    expect(id).toBe(7);
    expect(request.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The `savings` fact the store fires makes the read answer with the closed account.
    store.manualSavingsAnswer.set({
      accounts: [{ ...ISK, closedOn: '2026-12-15', balance: 0, growth: null }],
    });
    await fixture.whenStable();
    expect(root.querySelector('[data-closed]')).not.toBeNull();
    expect(root.querySelector('[data-new-entry]')).toBeNull();
    await openMenu('[data-manual-account]');
    await click('[data-reopen]');
    expect(sent('reopen')).toEqual([[7]]);
  });

  it('renames an account from its menu', async () => {
    const { click, type, openMenu } = await render();
    await openMenu('[data-manual-account]');
    await click('[data-rename]');
    await type('[data-rename-input]', 'Nordnet ISK');
    await click('[data-save-account]');
    expect(sent('rename')).toEqual([[7, { name: 'Nordnet ISK', institution: 'Avanza' }]]);
  });

  it('asks before removing an entry, and sends nothing when cancelled', async () => {
    const { fixture, root, click, openMenu } = await render();
    await openMenu('[data-entry]');
    await click('[data-delete-entry]');
    expect(sent('deleteEntry')).toEqual([]);
    expect(root.querySelector('[role=alertdialog] [data-title]')?.textContent).toContain(
      'Ta bort saldonoteringen?',
    );
    await click('[role=alertdialog] [data-cancel]');
    expect(root.querySelector('[role=alertdialog]')).toBeNull();

    await openMenu('[data-entry]');
    await click('[data-delete-entry]');
    await click('[role=alertdialog] [data-confirm]');
    expect(sent('deleteEntry')).toEqual([[7, 2]]);
    await fixture.whenStable();
    expect(root.querySelector('[role=alertdialog]')).toBeNull();
  });
});
