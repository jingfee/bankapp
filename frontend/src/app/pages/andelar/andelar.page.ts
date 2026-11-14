import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  SHARE_OPTIONS,
  type Category,
  type HouseholdRatioEntry,
  type ShareOption,
  type Subcategory,
} from '@bankapp/shared';
import { catchError, forkJoin, map, of } from 'rxjs';
import { CategoriesService } from '../../categories.service';
import { SharesService } from '../../shares.service';

interface Loaded {
  categories: Category[];
}

type State = Loaded | { failed: true };

const SHARE_LABELS: Record<ShareOption, string> = {
  me: 'Jag',
  half: '50/50',
  household: 'Hushåll',
  partner: 'Partner',
};

/** Today as `YYYY-MM-DD` in the owner's own time zone. */
function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

@Component({
  selector: 'app-andelar-page',
  imports: [RouterLink],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 class="text-3xl font-semibold tracking-tight">Andelar</h1>
        <p class="mt-1 text-zinc-600 dark:text-zinc-400">
          Din del av delade utgifter, per underkategori.
        </p>
        <a routerLink="/banker" class="mt-2 inline-block text-sm underline">Banker</a>
      </header>

      @if (error(); as message) {
        <p role="alert" class="text-sm text-red-700 dark:text-red-400">{{ message }}</p>
      }

      @let result = loaded();
      @if (!result) {
        <p aria-live="polite">Hämtar andelar…</p>
      } @else if ('failed' in result) {
        <p role="alert">Andelarna kunde inte hämtas. Försök igen senare.</p>
      } @else {
        <section
          class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 data-ratio-heading class="text-lg font-semibold">{{ ratioHeading() }}</h2>
          <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Din del av kostnader som delas som Hushåll. En ny hushållsandel gäller från sitt datum.
          </p>
          <ul class="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            @for (entry of ratio(); track entry.from; let i = $index) {
              <li data-ratio-entry class="flex flex-wrap items-center justify-between gap-2 py-2">
                @if (editing() === entry.from) {
                  <span class="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      data-edit-from
                      aria-label="Från datum"
                      class="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                      [value]="editFrom()"
                      (input)="editFrom.set(value($event))"
                    />
                    <input
                      type="number"
                      data-edit-percent
                      aria-label="Din andel i procent"
                      min="1"
                      max="99"
                      class="w-20 rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                      [value]="editPercent()"
                      (input)="editPercent.set(value($event))"
                    />
                  </span>
                  <span class="flex gap-3 text-sm">
                    <button
                      type="button"
                      data-save-edit
                      class="underline disabled:opacity-50"
                      [disabled]="saving()"
                      (click)="saveEdit(entry)"
                    >
                      Spara
                    </button>
                    <button type="button" class="underline" (click)="editing.set(null)">
                      Avbryt
                    </button>
                  </span>
                } @else {
                  <span>
                    Från {{ entry.from }}: {{ entry.percent }}/{{ 100 - entry.percent }}
                  </span>
                  <span class="flex gap-3 text-sm">
                    <button
                      type="button"
                      data-edit
                      class="underline disabled:opacity-50"
                      [disabled]="saving()"
                      (click)="startEdit(entry)"
                    >
                      Ändra
                    </button>
                    <button
                      type="button"
                      data-remove
                      class="underline disabled:opacity-50"
                      [disabled]="saving() || ratio().length === 1"
                      (click)="remove(entry)"
                    >
                      Ta bort
                    </button>
                  </span>
                }
              </li>
            }
          </ul>
          <form class="mt-4 flex flex-wrap items-end gap-3" (submit)="$event.preventDefault()">
            <label class="flex flex-col text-sm">
              Från
              <input
                type="date"
                data-add-from
                class="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                [value]="addFrom()"
                (input)="addFrom.set(value($event))"
              />
            </label>
            <label class="flex flex-col text-sm">
              Din andel (%)
              <input
                type="number"
                data-add-percent
                min="1"
                max="99"
                class="w-24 rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                [value]="addPercent()"
                (input)="addPercent.set(value($event))"
              />
            </label>
            <button
              type="button"
              data-add-ratio
              class="rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              [disabled]="saving()"
              (click)="add()"
            >
              Lägg till
            </button>
          </form>
        </section>

        @for (category of result.categories; track category.id) {
          <section
            data-category
            class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h3 class="text-lg font-semibold">{{ category.name }}</h3>
            <ul class="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
              @for (subcategory of category.subcategories; track subcategory.id) {
                @let current = shareOf(subcategory);
                <li
                  data-subcategory
                  class="flex items-center justify-between gap-3 rounded-lg py-2"
                  [attr.data-shared]="current === 'me' ? null : ''"
                  [class.bg-amber-50]="current !== 'me'"
                  [class.dark:bg-amber-950]="current !== 'me'"
                  [class.px-2]="current !== 'me'"
                  [class.font-medium]="current !== 'me'"
                >
                  <span data-name>{{ subcategory.name }}</span>
                  <select
                    [attr.aria-label]="'Andel för ' + subcategory.name"
                    class="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 disabled:opacity-50 dark:border-zinc-700"
                    [value]="current"
                    [disabled]="saving()"
                    (change)="setShare(subcategory, $event)"
                  >
                    @for (option of shareOptions; track option) {
                      <option [value]="option" [selected]="option === current">
                        {{ shareLabel(option) }}
                      </option>
                    }
                  </select>
                </li>
              }
            </ul>
          </section>
        }
      }
    </main>
  `,
})
export class AndelarPage {
  private readonly categoriesService = inject(CategoriesService);
  private readonly shares = inject(SharesService);

  protected readonly shareOptions = SHARE_OPTIONS;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The share of each subcategory that is not Jag. */
  private readonly subcategoryShares = signal(new Map<number, ShareOption>());
  protected readonly ratio = signal<HouseholdRatioEntry[]>([]);

  protected readonly editing = signal<string | null>(null);
  protected readonly editFrom = signal('');
  protected readonly editPercent = signal('');
  protected readonly addFrom = signal(today());
  protected readonly addPercent = signal('');

  protected readonly loaded = toSignal<State>(
    forkJoin({
      categories: this.categoriesService.list(),
      shares: this.shares.subcategoryShares(),
      ratio: this.shares.householdRatio(),
    }).pipe(
      map(({ categories, shares, ratio }): State => {
        this.subcategoryShares.set(new Map(shares.map((s) => [s.subcategoryId, s.share])));
        this.ratio.set(ratio);
        return { categories };
      }),
      catchError(() => of<State>({ failed: true })),
    ),
    { initialValue: undefined },
  );

  protected shareOf(subcategory: Subcategory): ShareOption {
    return this.subcategoryShares().get(subcategory.id) ?? 'me';
  }

  protected shareLabel(option: ShareOption): string {
    return SHARE_LABELS[option];
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** The ratio in force today: the latest entry from today or before, else the first. */
  protected ratioHeading(): string {
    const entries = this.ratio();
    const now = today();
    const inForce = entries.filter((e) => e.from <= now).at(-1) ?? entries[0];
    if (inForce === undefined) return 'Ingen hushållsandel inställd';
    return `Hushåll (${inForce.percent}/${100 - inForce.percent})`;
  }

  protected setShare(subcategory: Subcategory, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const option = select.value as ShareOption;
    const previous = this.shareOf(subcategory);
    this.saving.set(true);
    this.error.set(null);
    this.shares.setSubcategoryShare(subcategory.id, option).subscribe({
      next: () => {
        this.saving.set(false);
        this.subcategoryShares.update((map) => {
          const next = new Map(map);
          if (option === 'me') next.delete(subcategory.id);
          else next.set(subcategory.id, option);
          return next;
        });
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.error.set(
          (error as { status?: number }).status === 409
            ? 'Hushåll kan väljas först när en hushållsandel har ställts in.'
            : 'Andelen kunde inte sparas. Försök igen senare.',
        );
        select.value = previous;
      },
    });
  }

  protected add(): void {
    const entry = this.parse(this.addFrom(), this.addPercent());
    if (entry === null) return;
    this.saveRatio([...this.ratio().filter((e) => e.from !== entry.from), entry], () =>
      this.addPercent.set(''),
    );
  }

  protected startEdit(entry: HouseholdRatioEntry): void {
    this.editing.set(entry.from);
    this.editFrom.set(entry.from);
    this.editPercent.set(String(entry.percent));
  }

  protected saveEdit(original: HouseholdRatioEntry): void {
    const entry = this.parse(this.editFrom(), this.editPercent());
    if (entry === null) return;
    this.saveRatio(
      [...this.ratio().filter((e) => e.from !== original.from && e.from !== entry.from), entry],
      () => this.editing.set(null),
    );
  }

  protected remove(entry: HouseholdRatioEntry): void {
    if (this.ratio().length === 1) return;
    this.saveRatio(this.ratio().filter((e) => e.from !== entry.from));
  }

  /** A valid entry from the form's text, or null after showing what is wrong. */
  private parse(from: string, percentText: string): HouseholdRatioEntry | null {
    const percent = Number(percentText);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      this.error.set('Välj ett datum.');
      return null;
    }
    if (percentText.trim() === '' || !Number.isInteger(percent) || percent < 1 || percent > 99) {
      this.error.set('Andelen måste vara ett heltal mellan 1 och 99.');
      return null;
    }
    return { from, percent };
  }

  private saveRatio(entries: HouseholdRatioEntry[], done?: () => void): void {
    this.saving.set(true);
    this.error.set(null);
    this.shares
      .setHouseholdRatio([...entries].sort((a, b) => a.from.localeCompare(b.from)))
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.ratio.set(saved);
          done?.();
        },
        error: () => {
          this.saving.set(false);
          this.error.set('Hushållsandelen kunde inte sparas. Försök igen senare.');
        },
      });
  }
}
