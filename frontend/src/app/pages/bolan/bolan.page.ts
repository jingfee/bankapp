import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CATEGORY_PALETTE,
  type LoanPart,
  type MortgageEntry,
  type MortgageFiguresResponse,
  type MortgageMonth,
  type MortgageResponse,
  type RecurringDayRequest,
} from '@bankapp/shared';
import { type Observable, type Subscription, concat, last } from 'rxjs';
import { CategoriesService } from '../../categories.service';
import { DateField } from '../../date-field/date-field';
import { today } from '../../dates';
import { formatAmountInput, parseAmount } from '../../formatting/amount';
import { MoneyPipe } from '../../formatting/money.pipe';
import { APP_LOCALE } from '../../formatting/locale';
import { MortgageService } from '../../mortgage.service';
import {
  type ChartMode,
  type Range,
  RANGES,
  buildChart,
  countdown,
  currentMonth,
  inRange,
  lastDayOf,
  needsNewRate,
  totals,
} from './bolan-view';

/** The form that is open besides a part's own edit form: at most one at a time. */
type Panel = { kind: 'add-part' } | { kind: 'entry'; entry: MortgageEntry | null };

const INTERVAL = /^\d+$/;

const MONTH_LONG = new Intl.DateTimeFormat(APP_LOCALE, { month: 'long' });
const MONTH_SHORT = new Intl.DateTimeFormat(APP_LOCALE, { month: 'short' });
const MONTH_YEAR = new Intl.DateTimeFormat(APP_LOCALE, { month: 'short', year: '2-digit' });
const KR = new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 0 });

const monthDate = (month: string) =>
  new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);

/** A colour for each loan part's segment, in the order the parts are listed. */
const PART_COLOURS = [
  'indigo',
  'teal',
  'amber',
  'rose',
  'sky',
  'emerald',
  'purple',
  'orange',
] as const;

/**
 * Bolån: what is left of the mortgage, what it costs per month, when its rate and terms come
 * up, and the actions to set it up and keep it up to date by hand. Nothing mortgage-related is
 * shown anywhere else.
 */
@Component({
  selector: 'app-bolan-page',
  imports: [DateField, MoneyPipe, NgTemplateOutlet, RouterLink],
  template: `
    <main class="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:gap-5 sm:p-8">
      <h1 class="font-display text-2xl font-bold tracking-tight">Bolån</h1>

      @if (failed(); as message) {
        <p role="alert" class="text-danger">{{ message }}</p>
      }

      @if (parts().length === 0) {
        <section class="card flex flex-col gap-3 p-5" data-intro>
          <p class="text-muted">
            Följ bolånet här: vad som är kvar att betala, vad det kostar per månad och när räntan
            och villkoren ska ses över. Lägg till bolånet med dess första lånedel.
          </p>
          <div>
            <button
              type="button"
              data-add-part-intro
              class="btn btn-primary"
              (click)="startAddPart()"
            >
              Lägg till bolån
            </button>
          </div>
        </section>
      }

      @if (openParts().length > 0) {
        <section class="card grid gap-4 p-5 sm:grid-cols-3" data-summary>
          <div class="flex flex-col gap-1">
            <span class="text-sm text-muted">Kvarvarande skuld</span>
            <span data-total-debt class="amount text-2xl">{{ summary().debt | money }}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-sm text-muted">Snittränta</span>
            <span data-average-rate class="amount text-2xl">{{
              summary().rate === null ? '–' : percent(summary().rate!)
            }}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-sm text-muted">Beräknad månadsbetalning</span>
            @if (estimate(); as e) {
              <span data-estimate class="amount text-2xl">{{ e.total | money }}</span>
              <span class="text-sm text-muted">
                Ränta <span data-estimate-interest class="amount">{{ e.interest | money }}</span> ·
                Amortering
                <span data-estimate-amortisation class="amount">{{ e.amortisation | money }}</span>
              </span>
            } @else {
              <span data-estimate class="amount text-2xl">–</span>
            }
          </div>
        </section>

        @for (month of unpaidMonths(); track month.month) {
          <p data-no-payment class="text-sm text-muted">
            Ingen bolånebetalning hittad i {{ month.name }}.
            <a
              data-no-payment-link
              class="text-accent underline"
              routerLink="/transaktioner"
              [queryParams]="month.params"
              >Visa transaktionerna</a
            >
          </p>
        }
      }

      @if (chartMonths().length > 0) {
        <section class="card p-4 sm:p-5" data-chart-card>
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 class="font-display text-lg font-semibold">
              {{ mode() === 'debt' ? 'Kvarvarande skuld' : 'Beräknat vs Betalt' }}
            </h2>
            <div class="flex flex-wrap gap-2">
              <div class="flex gap-1" role="group" aria-label="Diagram">
                <button
                  type="button"
                  data-mode="debt"
                  class="chip"
                  [attr.aria-pressed]="mode() === 'debt'"
                  (click)="mode.set('debt'); hovered.set(null)"
                >
                  Skuld
                </button>
                <button
                  type="button"
                  data-mode="paid"
                  class="chip"
                  [attr.aria-pressed]="mode() === 'paid'"
                  (click)="mode.set('paid'); hovered.set(null)"
                >
                  Beräknat vs Betalt
                </button>
              </div>
              <div class="flex gap-1" role="group" aria-label="Period">
                @for (option of ranges; track option.id) {
                  <button
                    type="button"
                    [attr.data-range]="option.id"
                    class="chip"
                    [attr.aria-pressed]="range() === option.id"
                    (click)="range.set(option.id); hovered.set(null)"
                  >
                    {{ option.label }}
                  </button>
                }
              </div>
            </div>
          </div>
          @if (chart(); as c) {
            <div class="flex gap-2">
              <div class="relative h-36 w-16 shrink-0" aria-hidden="true">
                @for (tick of c.yTicks; track tick.pct) {
                  <span
                    class="absolute right-0 translate-y-1/2 text-[11px] whitespace-nowrap text-muted"
                    [style.bottom.%]="tick.pct"
                    >{{ kr(tick.value) }}</span
                  >
                }
              </div>
              <div class="min-w-0 flex-1">
                <div
                  data-chart-plot
                  class="relative h-36 touch-pan-y"
                  (pointerleave)="hovered.set(null)"
                  (pointerdown)="touchMonth($event)"
                  (pointermove)="touchMonth($event)"
                >
                  @for (tick of c.yTicks; track tick.pct) {
                    <div
                      class="absolute inset-x-0 border-t border-line"
                      [style.bottom.%]="tick.pct"
                    ></div>
                  }
                  <svg
                    viewBox="0 0 300 120"
                    class="absolute inset-0 size-full overflow-visible"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    @for (bar of c.bars; track $index) {
                      <rect
                        data-bar
                        [attr.data-series]="bar.series"
                        [attr.x]="bar.x"
                        [attr.y]="bar.y"
                        [attr.width]="bar.width"
                        [attr.height]="bar.height"
                        [attr.fill]="bar.colour"
                      />
                    }
                  </svg>
                  @if (tip(); as t) {
                    <div
                      class="pointer-events-none absolute inset-y-0 w-px bg-line-strong"
                      [style.left.%]="t.pct"
                    ></div>
                    <div
                      data-chart-tooltip
                      class="pointer-events-none absolute top-0 z-10 flex flex-col gap-1 rounded-[10px] border border-line-strong bg-surface-3 px-3 py-2 text-xs whitespace-nowrap shadow-lg"
                      [style.left.%]="t.pct"
                      [style.transform]="'translateX(-' + t.pct + '%)'"
                    >
                      <span class="font-semibold">{{ t.title }}</span>
                      @for (line of t.lines; track line.label) {
                        <span class="flex items-center gap-2"
                          ><span class="size-2 rounded-full" [style.background]="line.colour"></span
                          >{{ line.label }}
                          <span class="amount">{{ line.amount | money }}</span></span
                        >
                      }
                    </div>
                  }
                  @for (slot of c.slots; track slot.month; let i = $index) {
                    <div
                      class="absolute inset-y-0"
                      [attr.data-chart-month]="slot.month"
                      [style.left.%]="(i / c.slots.length) * 100"
                      [style.width.%]="100 / c.slots.length"
                      (pointerenter)="hovered.set(i)"
                    ></div>
                  }
                </div>
                <div class="relative mt-1 h-4" aria-hidden="true">
                  @for (tick of xTicks(); track tick.month) {
                    <span
                      data-x-tick
                      class="absolute text-[11px] text-muted"
                      [style.left.%]="tick.pct"
                      [style.transform]="'translateX(-' + tick.pct + '%)'"
                      >{{ tick.label }}</span
                    >
                  }
                </div>
              </div>
            </div>
            <p class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" data-legend>
              @for (item of legend(); track item.label) {
                <span class="flex items-center gap-1.5"
                  ><span class="size-2 rounded-full" [style.background]="item.colour"></span
                  >{{ item.label }}</span
                >
              }
            </p>
          }
        </section>
      }

      <section class="card flex flex-col gap-4 p-5" data-mortgage>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-display text-lg font-semibold">Lånedelar</h2>
          <div class="flex flex-wrap gap-2">
            @if (openParts().length > 0 && panel()?.kind !== 'entry') {
              <button
                type="button"
                data-new-entry
                class="btn btn-sm btn-secondary"
                (click)="startEntry(null)"
              >
                Ny bolånenotering
              </button>
            }
            @if (panel()?.kind !== 'add-part') {
              <button
                type="button"
                data-add-part
                class="btn btn-sm btn-secondary"
                (click)="startAddPart()"
              >
                {{ parts().length === 0 ? 'Lägg till bolån' : 'Lägg till lånedel' }}
              </button>
            }
          </div>
        </div>

        @if (panel()?.kind === 'add-part') {
          <form
            data-part-form
            class="flex flex-col gap-4"
            (submit)="$event.preventDefault(); addPart()"
          >
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="flex flex-col gap-1 text-sm text-muted sm:col-span-2">
                Namn
                <input
                  data-name
                  class="input"
                  placeholder="Del 1 – 3 mån"
                  [value]="name()"
                  (input)="name.set(value($event))"
                />
              </label>
              <label class="flex flex-col gap-1 text-sm text-muted">
                Startdatum
                <app-date-field [value]="date()" (valueChange)="date.set($event)" />
              </label>
              <label class="flex flex-col gap-1 text-sm text-muted">
                Kvarvarande skuld
                <span class="field">
                  <input
                    data-debt
                    type="text"
                    inputmode="decimal"
                    class="field-control"
                    [value]="debt()"
                    (input)="debt.set(value($event))"
                  />
                  <span class="field-suffix">kr</span>
                </span>
              </label>
              <label class="flex flex-col gap-1 text-sm text-muted">
                Ränta
                <span class="field">
                  <input
                    data-rate
                    type="text"
                    inputmode="decimal"
                    class="field-control"
                    [value]="rate()"
                    (input)="rate.set(value($event))"
                  />
                  <span class="field-suffix">%</span>
                </span>
              </label>
              <label class="flex flex-col gap-1 text-sm text-muted">
                Amortering per månad
                <span class="field">
                  <input
                    data-amortisation
                    type="text"
                    inputmode="decimal"
                    class="field-control"
                    [value]="amount()"
                    (input)="amount.set(value($event))"
                  />
                  <span class="field-suffix">kr</span>
                </span>
              </label>
              <ng-container *ngTemplateOutlet="days" />
            </div>
            <ng-container *ngTemplateOutlet="formActions; context: { save: 'Spara lånedel' }" />
          </form>
        }

        <ul class="flex flex-col divide-y divide-line">
          @for (part of openParts(); track part.id) {
            <li class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0" [attr.data-part]="part.id">
              <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 flex-col gap-1">
                  <span data-part-name class="truncate font-medium">{{ part.name }}</span>
                  <span class="text-sm text-muted">
                    Skuld
                    <span data-part-debt class="amount">{{
                      partDebt(part) === null ? '–' : (partDebt(part)! | money)
                    }}</span>
                    · Ränta
                    <span data-part-rate>{{ part.rate === null ? '–' : percent(part.rate) }}</span>
                    · Amortering
                    <span data-part-amortisation class="amount">{{
                      part.amortisation === null ? '–' : (part.amortisation | money)
                    }}</span
                    >/mån
                    @if (partInterest(part); as interest) {
                      · Ränta denna månad
                      <span data-part-interest class="amount">{{ interest | money }}</span>
                    }
                  </span>
                  <span class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                    <span>
                      Räntejustering
                      <span
                        data-rate-day
                        [class.text-accent]="countdown(part.rateAdjustment.next).soon"
                        [class.font-medium]="countdown(part.rateAdjustment.next).soon"
                        >{{ part.rateAdjustment.next }}</span
                      >
                      @if (countdown(part.rateAdjustment.next).text; as text) {
                        <span data-rate-soon class="pill pill-accent">{{ text }}</span>
                      }
                    </span>
                    <span>
                      Villkorsändring
                      <span
                        data-terms-day
                        [class.text-accent]="countdown(part.termsChange.next).soon"
                        [class.font-medium]="countdown(part.termsChange.next).soon"
                        >{{ part.termsChange.next }}</span
                      >
                      @if (countdown(part.termsChange.next).text; as text) {
                        <span data-terms-soon class="pill pill-accent">{{ text }}</span>
                      }
                    </span>
                  </span>
                  @if (needsNewRate(part)) {
                    <div
                      data-rate-prompt
                      class="mt-1 flex flex-wrap items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-2 text-sm"
                    >
                      <span>Dags att ange ny ränta för {{ part.name }}</span>
                      @if (newRateId() !== part.id) {
                        <button
                          type="button"
                          data-new-rate
                          class="btn btn-sm btn-secondary"
                          (click)="startNewRate(part)"
                        >
                          Ny ränta
                        </button>
                      }
                    </div>
                  }
                </div>
                @if (!part.endedOn && editingId() !== part.id) {
                  <button
                    type="button"
                    data-edit
                    class="btn btn-sm btn-secondary flex-none"
                    (click)="startEdit(part)"
                  >
                    Ändra
                  </button>
                }
              </div>

              @if (newRateId() === part.id) {
                <form
                  data-new-rate-form
                  class="flex flex-col gap-3"
                  (submit)="$event.preventDefault(); saveNewRate(part)"
                >
                  <div class="grid gap-3 sm:grid-cols-2">
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Ny ränta
                      <span class="field">
                        <input
                          data-rate
                          type="text"
                          inputmode="decimal"
                          class="field-control"
                          [value]="rate()"
                          (input)="rate.set(value($event))"
                        />
                        <span class="field-suffix">%</span>
                      </span>
                    </label>
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Gäller från
                      <app-date-field
                        data-rate-from
                        [value]="rateFrom()"
                        (valueChange)="rateFrom.set($event)"
                      />
                    </label>
                  </div>
                  <p class="text-xs text-muted">Samma ränta som förut går också bra.</p>
                  <ng-container *ngTemplateOutlet="formActions; context: { save: 'Spara ränta' }" />
                </form>
              }

              @if (editingId() === part.id) {
                <form
                  data-part-panel
                  class="flex flex-col gap-4"
                  (submit)="$event.preventDefault(); saveEdit(part)"
                >
                  <div class="grid gap-3 sm:grid-cols-2">
                    <label class="flex flex-col gap-1 text-sm text-muted sm:col-span-2">
                      Namn
                      <input
                        data-name
                        class="input"
                        [value]="name()"
                        (input)="name.set(value($event))"
                      />
                    </label>
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Ränta
                      <span class="field">
                        <input
                          data-rate
                          type="text"
                          inputmode="decimal"
                          class="field-control"
                          [value]="rate()"
                          (input)="rate.set(value($event)); rateTouched.set(true)"
                        />
                        <span class="field-suffix">%</span>
                      </span>
                    </label>
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Gäller från
                      <app-date-field
                        data-rate-from
                        [value]="rateFrom()"
                        (valueChange)="rateFrom.set($event); rateTouched.set(true)"
                      />
                    </label>
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Amortering per månad
                      <span class="field">
                        <input
                          data-amortisation
                          type="text"
                          inputmode="decimal"
                          class="field-control"
                          [value]="amount()"
                          (input)="amount.set(value($event)); amountTouched.set(true)"
                        />
                        <span class="field-suffix">kr</span>
                      </span>
                    </label>
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Gäller från
                      <app-date-field
                        data-amortisation-from
                        [value]="amountFrom()"
                        (valueChange)="amountFrom.set($event); amountTouched.set(true)"
                      />
                    </label>
                    <ng-container *ngTemplateOutlet="days" />
                  </div>
                  <p class="text-xs text-muted">
                    Ränta och amortering sparas som en ny ändring bara om du rör dem. Samma ränta
                    igen noteras också.
                  </p>
                  @if (ending()) {
                    <div
                      data-end-row
                      class="flex flex-col gap-2 rounded-[10px] border border-line-strong p-3"
                    >
                      <label class="flex flex-col gap-1 text-sm text-muted">
                        Avslutad den
                        <app-date-field [value]="endDate()" (valueChange)="endDate.set($event)" />
                      </label>
                      <div class="flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-confirm-end
                          class="btn btn-sm btn-secondary"
                          [disabled]="busy()"
                          (click)="endPart(part)"
                        >
                          Avsluta lånedelen
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm btn-ghost"
                          (click)="ending.set(false)"
                        >
                          Behåll
                        </button>
                      </div>
                    </div>
                  }
                  <ng-container
                    *ngTemplateOutlet="formActions; context: { save: 'Spara', end: true }"
                  />
                </form>
              }
            </li>
          }
        </ul>

        @if (endedParts().length > 0) {
          <details data-ended-parts>
            <summary class="cursor-pointer text-sm text-muted">
              Avslutade lånedelar ({{ endedParts().length }})
            </summary>
            <ul class="mt-3 flex flex-col divide-y divide-line">
              @for (part of endedParts(); track part.id) {
                <li
                  class="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
                  [attr.data-part]="part.id"
                >
                  <span data-part-name class="truncate font-medium">{{ part.name }}</span>
                  <span data-ended class="text-sm text-muted">
                    {{ part.startedOn }} – {{ part.endedOn }}
                  </span>
                </li>
              }
            </ul>
          </details>
        }
      </section>

      @if (panel()?.kind === 'entry') {
        <section class="card flex flex-col gap-4 p-5">
          <h2 class="font-display text-lg font-semibold">Bolånenotering</h2>
          <form
            data-entry-form
            class="flex flex-col gap-4"
            (submit)="$event.preventDefault(); saveEntry()"
          >
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="flex flex-col gap-1 text-sm text-muted sm:col-span-2">
                Datum
                <app-date-field data-entry-date [value]="date()" (valueChange)="date.set($event)" />
              </label>
              @for (part of entryParts(); track part.id) {
                <label class="flex flex-col gap-1 text-sm text-muted">
                  {{ part.name }}
                  <span class="field">
                    <input
                      type="text"
                      inputmode="decimal"
                      class="field-control"
                      [attr.data-entry-debt]="part.id"
                      [value]="debts()[part.id] ?? ''"
                      (input)="setDebt(part.id, value($event))"
                    />
                    <span class="field-suffix">kr</span>
                  </span>
                </label>
              }
            </div>
            <ng-container *ngTemplateOutlet="formActions; context: { save: 'Spara notering' }" />
          </form>
        </section>
      }

      @if (entries().length > 0) {
        <section class="card flex flex-col gap-3 p-5">
          <h2 class="font-display text-lg font-semibold">Noteringar</h2>
          <ul class="flex flex-col divide-y divide-line text-sm" data-entries>
            @for (entry of entries(); track entry.id) {
              <li class="flex items-start justify-between gap-3 py-2" data-entry>
                <span class="flex min-w-0 flex-wrap gap-x-3">
                  <span data-entry-day>{{ entry.date }}</span>
                  @for (debt of entry.debts; track debt.partId) {
                    <span class="text-muted">
                      {{ partName(debt.partId) }}
                      <span class="amount">{{ debt.debt | money }}</span>
                    </span>
                  }
                </span>
                <span class="flex flex-none gap-1">
                  <button
                    type="button"
                    data-edit-entry
                    class="btn btn-sm btn-ghost"
                    (click)="startEntry(entry)"
                  >
                    Ändra
                  </button>
                  <button
                    type="button"
                    data-delete-entry
                    class="btn btn-sm btn-ghost"
                    [disabled]="busy()"
                    (click)="deleteEntry(entry)"
                  >
                    Ta bort
                  </button>
                </span>
              </li>
            }
          </ul>
        </section>
      }
    </main>

    <ng-template #days>
      <label class="flex flex-col gap-1 text-sm text-muted">
        Nästa räntejusteringsdag
        <app-date-field data-rate-date [value]="rateDate()" (valueChange)="rateDate.set($event)" />
      </label>
      <label class="flex flex-col gap-1 text-sm text-muted">
        Intervall
        <span class="field">
          <input
            data-rate-interval
            type="text"
            inputmode="numeric"
            class="field-control"
            [value]="rateInterval()"
            (input)="rateInterval.set(value($event))"
          />
          <span class="field-suffix">mån</span>
        </span>
      </label>
      <label class="flex flex-col gap-1 text-sm text-muted">
        Nästa villkorsändringsdag
        <app-date-field
          data-terms-date
          [value]="termsDate()"
          (valueChange)="termsDate.set($event)"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm text-muted">
        Intervall
        <span class="field">
          <input
            data-terms-interval
            type="text"
            inputmode="numeric"
            class="field-control"
            [value]="termsInterval()"
            (input)="termsInterval.set(value($event))"
          />
          <span class="field-suffix">mån</span>
        </span>
      </label>
    </ng-template>

    <ng-template #formActions let-save="save" let-end="end">
      @if (formError(); as message) {
        <p data-form-error role="alert" class="text-sm text-danger">{{ message }}</p>
      }
      <div class="flex flex-wrap items-center gap-2">
        <button type="submit" data-save class="btn btn-primary" [disabled]="busy()">
          {{ save }}
        </button>
        <button type="button" data-cancel class="btn btn-ghost" (click)="cancel()">Avbryt</button>
        @if (end && !ending()) {
          <button type="button" data-end class="btn btn-ghost ml-auto" (click)="ending.set(true)">
            Avsluta lånedel…
          </button>
        }
      </div>
    </ng-template>
  `,
})
export class BolanPage {
  private readonly service = inject(MortgageService);
  private readonly categories = inject(CategoriesService);
  private readonly now = today();
  private figuresRequest: Subscription | undefined;

  protected readonly mortgage = signal<MortgageResponse>({ parts: [], entries: [] });
  protected readonly parts = computed(() => this.mortgage().parts);
  protected readonly entries = computed(() => this.mortgage().entries);
  protected readonly openParts = computed(() => this.parts().filter((part) => !part.endedOn));
  protected readonly endedParts = computed(() => this.parts().filter((part) => part.endedOn));
  protected readonly figures = signal<MortgageFiguresResponse>({
    debts: [],
    months: [],
    monthsWithoutPayment: [],
  });
  /** The id of Bolån ränta & amortering, for the link from a month with no payment. */
  private readonly subcategoryId = signal<number | null>(null);
  protected readonly newRateId = signal<number | null>(null);
  protected readonly mode = signal<ChartMode>('debt');
  protected readonly range = signal<Range>('1y');
  protected readonly ranges = RANGES;
  protected readonly hovered = signal<number | null>(null);

  protected readonly summary = computed(() => totals(this.parts(), this.figures().debts));
  /** This month's estimate, if the mortgage has figures. */
  protected readonly estimate = computed(() => {
    const month = currentMonth(this.figures(), this.now);
    return month === undefined
      ? null
      : { total: month.total, interest: month.interest, amortisation: month.amortisation };
  });

  /** A calm note for each month flagged by the backend, linking to its transactions. */
  protected readonly unpaidMonths = computed(() =>
    this.figures().monthsWithoutPayment.map((month) => ({
      month,
      name: MONTH_LONG.format(monthDate(month)),
      params: {
        from: `${month}-01`,
        to: lastDayOf(month),
        ...(this.subcategoryId() === null ? {} : { subcategories: String(this.subcategoryId()) }),
      },
    })),
  );

  protected readonly chartMonths = computed(() => inRange(this.figures().months, this.range()));

  private readonly colours = computed(() => {
    const colours = new Map<number | string, string>();
    this.parts().forEach((part, i) => {
      colours.set(part.id, CATEGORY_PALETTE[PART_COLOURS[i % PART_COLOURS.length]!].colour);
    });
    colours.set('estimate', 'var(--color-accent)');
    colours.set('paid', CATEGORY_PALETTE.teal.colour);
    return colours;
  });

  protected readonly chart = computed(() => {
    const months = this.chartMonths();
    return months.length === 0 ? null : buildChart(months, this.mode(), this.colours());
  });

  protected readonly xTicks = computed(() => {
    const months = this.chartMonths();
    const every = months.length <= 12 ? 1 : Math.ceil(months.length / 6);
    return months.flatMap((m, i) =>
      i % every === 0 || i === months.length - 1
        ? [
            {
              month: m.month,
              pct: ((i + 0.5) / months.length) * 100,
              label: (months.length <= 12 ? MONTH_SHORT : MONTH_YEAR).format(monthDate(m.month)),
            },
          ]
        : [],
    );
  });

  protected readonly legend = computed(() =>
    this.mode() === 'paid'
      ? [
          { label: 'Beräknat', colour: this.colours().get('estimate')! },
          { label: 'Betalt', colour: this.colours().get('paid')! },
        ]
      : this.parts()
          .filter((part) =>
            this.chartMonths().some((m) => m.debts.some((d) => d.partId === part.id)),
          )
          .map((part) => ({ label: part.name, colour: this.colours().get(part.id)! })),
  );

  protected readonly tip = computed(() => {
    const c = this.chart();
    const index = this.hovered();
    const month = index === null ? undefined : this.chartMonths()[index];
    if (c === null || month === undefined || index === null) return null;
    const title = `${MONTH_LONG.format(monthDate(month.month))} ${month.month.slice(0, 4)}`;
    const lines =
      this.mode() === 'debt'
        ? month.debts.map((d) => ({
            label: this.partName(d.partId),
            colour: this.colours().get(d.partId)!,
            amount: d.debt,
          }))
        : [
            { label: 'Beräknat', colour: this.colours().get('estimate')!, amount: month.total },
            { label: 'Betalt', colour: this.colours().get('paid')!, amount: month.paid },
          ];
    return { title, lines, pct: ((index + 0.5) / this.chartMonths().length) * 100 };
  });
  protected readonly failed = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly panel = signal<Panel | null>(null);
  protected readonly formError = signal<string | null>(null);

  protected readonly name = signal('');
  protected readonly date = signal(today());
  protected readonly editingId = signal<number | null>(null);
  protected readonly ending = signal(false);
  protected readonly endDate = signal(today());
  protected readonly rateFrom = signal(today());
  protected readonly amountFrom = signal(today());
  protected readonly rateTouched = signal(false);
  protected readonly amountTouched = signal(false);
  protected readonly debt = signal('');
  protected readonly rate = signal('');
  protected readonly amount = signal('');
  protected readonly rateDate = signal('');
  protected readonly rateInterval = signal('3');
  protected readonly termsDate = signal('');
  protected readonly termsInterval = signal('12');
  /** The debt typed for each part in the entry form, as text. */
  protected readonly debts = signal<Record<number, string>>({});

  /** The parts an entry on the chosen day asks about: those open on it. */
  protected readonly entryParts = computed(() => {
    const day = this.date();
    return this.parts().filter(
      (part) => part.startedOn <= day && (part.endedOn === null || day < part.endedOn),
    );
  });

  constructor() {
    this.service.get().subscribe({
      next: (mortgage) => this.mortgage.set(mortgage),
      error: () => this.failed.set('Bolånet kunde inte hämtas. Försök igen senare.'),
    });
    this.loadFigures();
    this.categories.subcategories().subscribe({
      next: (all) =>
        this.subcategoryId.set(
          all.find((item) => item.subcategory.name === 'Bolån ränta & amortering')?.subcategory
            .id ?? null,
        ),
      // The note then links to the month's transactions without the category filter.
      error: () => undefined,
    });
  }

  /** The figures follow every change to the mortgage, so they are asked for again after one. */
  private loadFigures(): void {
    // Only the latest request counts: an older, slower response must not overwrite a newer one.
    this.figuresRequest?.unsubscribe();
    this.figuresRequest = this.service.figures().subscribe({
      next: (figures) => {
        this.figures.set(figures);
        this.failed.set(null);
      },
      error: () => this.failed.set('Bolånets siffror kunde inte hämtas. Försök igen senare.'),
    });
  }

  protected countdown(day: string) {
    return countdown(day, this.now);
  }

  protected needsNewRate(part: LoanPart): boolean {
    return needsNewRate(part, this.now);
  }

  protected kr(value: number): string {
    return `${KR.format(Math.round(value))} kr`;
  }

  /** The debt now, from the figures; the latest entry's until they arrive. */
  protected partDebt(part: LoanPart): number | null {
    return this.figures().debts.find((d) => d.partId === part.id)?.debt ?? part.debt;
  }

  /** This month's estimated interest on the part: its debt at the start of the month, at its rate. */
  protected partInterest(part: LoanPart): number | null {
    const month: MortgageMonth | undefined = currentMonth(this.figures(), this.now);
    const debt = month?.debts.find((d) => d.partId === part.id)?.debt;
    if (debt === undefined || part.rate === null) return null;
    return Math.round(((debt * part.rate) / 1200) * 100) / 100;
  }

  /** Follows a finger across the chart: a touch pointer never enters the per-month columns. */
  protected touchMonth(event: PointerEvent): void {
    const length = this.chartMonths().length;
    if (event.pointerType !== 'touch' || length < 1) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (box.width <= 0) return;
    const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 0.999999);
    this.hovered.set(Math.floor(ratio * length));
  }

  protected startNewRate(part: LoanPart): void {
    this.reset();
    this.rate.set(part.rate === null ? '' : formatAmountInput(part.rate));
    this.newRateId.set(part.id);
  }

  /** Records the rate, also when it is the same as before: that clears the prompt. */
  protected saveNewRate(part: LoanPart): void {
    const rate = parseAmount(this.rate());
    if (rate === null || rate < 0) return this.formError.set('Ange räntan i procent, t.ex. 3,85.');
    if (this.rateFrom() === '') return this.formError.set('Ange från vilket datum räntan gäller.');
    this.submit(this.service.addRateChange(part.id, { from: this.rateFrom(), rate }));
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected percent(rate: number): string {
    return `${formatAmountInput(rate)} %`;
  }

  protected partName(id: number): string {
    return this.parts().find((part) => part.id === id)?.name ?? '–';
  }

  protected startAddPart(): void {
    this.reset();
    this.date.set(today());
    this.panel.set({ kind: 'add-part' });
  }

  /** Opens the one edit form for a part, filled with what is in force now. */
  protected startEdit(part: LoanPart): void {
    this.reset();
    this.name.set(part.name);
    this.rate.set(part.rate === null ? '' : formatAmountInput(part.rate));
    this.amount.set(part.amortisation === null ? '' : formatAmountInput(part.amortisation));
    this.rateDate.set(part.rateAdjustment.next);
    this.rateInterval.set(String(part.rateAdjustment.intervalMonths));
    this.termsDate.set(part.termsChange.next);
    this.termsInterval.set(String(part.termsChange.intervalMonths));
    this.editingId.set(part.id);
  }

  protected cancel(): void {
    this.panel.set(null);
    this.editingId.set(null);
    this.newRateId.set(null);
  }

  /** Opens the entry form for a new entry, prefilled with the current debts, or to correct one. */
  protected startEntry(entry: MortgageEntry | null): void {
    this.reset();
    this.date.set(entry?.date ?? today());
    this.debts.set(
      Object.fromEntries(
        entry
          ? entry.debts.map((debt) => [debt.partId, formatAmountInput(debt.debt)])
          : this.openParts().map((part) => [
              part.id,
              part.debt === null ? '' : formatAmountInput(part.debt),
            ]),
      ),
    );
    this.panel.set({ kind: 'entry', entry });
  }

  protected setDebt(partId: number, text: string): void {
    this.debts.update((all) => ({ ...all, [partId]: text }));
  }

  protected addPart(): void {
    const debt = parseAmount(this.debt());
    const rate = parseAmount(this.rate());
    const amortisation = parseAmount(this.amount());
    if (this.name().trim() === '') return this.formError.set('Ange ett namn.');
    if (this.date() === '' || this.date() > today()) {
      return this.formError.set('Ange ett startdatum som inte ligger i framtiden.');
    }
    if (debt === null || debt < 0) return this.formError.set('Ange skulden som ett belopp.');
    if (rate === null || rate < 0) return this.formError.set('Ange räntan i procent, t.ex. 3,85.');
    if (amortisation === null || amortisation < 0) {
      return this.formError.set('Ange amorteringen som ett belopp, 0 eller mer.');
    }
    const days = this.recurringDays();
    if (days === null) return;
    this.submit(
      this.service.addPart({
        name: this.name().trim(),
        startedOn: this.date(),
        debt,
        rate,
        amortisation,
        rateAdjustment: days.rateAdjustment,
        termsChange: days.termsChange,
      }),
    );
  }

  /**
   * Saves the edit form: name and days always; a new rate or amortisation only if the owner
   * touched it, so re-entering the same rate records that it was checked.
   */
  protected saveEdit(part: LoanPart): void {
    if (this.name().trim() === '') return this.formError.set('Ange ett namn.');
    const days = this.recurringDays();
    if (days === null) return;
    const calls: Observable<MortgageResponse>[] = [
      this.service.updatePart(part.id, { name: this.name().trim(), ...days }),
    ];
    if (this.rateTouched()) {
      const rate = parseAmount(this.rate());
      if (rate === null || rate < 0)
        return this.formError.set('Ange räntan i procent, t.ex. 3,85.');
      if (this.rateFrom() === '')
        return this.formError.set('Ange från vilket datum räntan gäller.');
      calls.push(this.service.addRateChange(part.id, { from: this.rateFrom(), rate }));
    }
    if (this.amountTouched()) {
      const amount = parseAmount(this.amount());
      if (amount === null || amount < 0) {
        return this.formError.set('Ange amorteringen som ett belopp, 0 eller mer.');
      }
      if (this.amountFrom() === '') {
        return this.formError.set('Ange från vilket datum amorteringen gäller.');
      }
      calls.push(this.service.addAmortisationChange(part.id, { from: this.amountFrom(), amount }));
    }
    this.submit(concat(...calls).pipe(last()));
  }

  protected endPart(part: LoanPart): void {
    if (this.endDate() === '' || this.endDate() > today()) {
      return this.formError.set('Ange ett datum som inte ligger i framtiden.');
    }
    this.submit(this.service.endPart(part.id, { date: this.endDate() }));
  }

  protected saveEntry(): void {
    const open = this.panel();
    if (open?.kind !== 'entry') return;
    if (this.date() === '' || this.date() > today()) {
      return this.formError.set('Ange ett datum som inte ligger i framtiden.');
    }
    const debts: { partId: number; debt: number }[] = [];
    for (const part of this.entryParts()) {
      const debt = parseAmount(this.debts()[part.id] ?? '');
      if (debt === null || debt < 0) {
        return this.formError.set(`Ange skulden för ${part.name} som ett belopp.`);
      }
      debts.push({ partId: part.id, debt });
    }
    if (debts.length === 0) return this.formError.set('Ingen lånedel är öppen det datumet.');
    const request = { date: this.date(), debts };
    this.submit(
      open.entry
        ? this.service.updateEntry(open.entry.id, request)
        : this.service.addEntry(request),
    );
  }

  protected deleteEntry(entry: MortgageEntry): void {
    if (!confirm(`Ta bort bolånenoteringen ${entry.date}?`)) return;
    this.busy.set(true);
    this.failed.set(null);
    this.service.deleteEntry(entry.id).subscribe({
      next: (mortgage) => {
        this.busy.set(false);
        this.mortgage.set(mortgage);
        this.loadFigures();
      },
      error: () => {
        this.busy.set(false);
        this.failed.set('Noteringen kunde inte tas bort. Försök igen senare.');
      },
    });
  }

  private recurringDays(): {
    rateAdjustment: RecurringDayRequest;
    termsChange: RecurringDayRequest;
  } | null {
    const read = (dateText: string, intervalText: string, label: string) => {
      const interval = INTERVAL.test(intervalText.trim()) ? Number(intervalText.trim()) : 0;
      if (dateText === '' || interval < 1) {
        this.formError.set(`Ange ${label} och ett intervall på minst 1 månad.`);
        return null;
      }
      return { next: dateText, intervalMonths: interval };
    };
    const rateAdjustment = read(this.rateDate(), this.rateInterval(), 'nästa räntejusteringsdag');
    if (rateAdjustment === null) return null;
    const termsChange = read(this.termsDate(), this.termsInterval(), 'nästa villkorsändringsdag');
    if (termsChange === null) return null;
    return { rateAdjustment, termsChange };
  }

  private reset(): void {
    this.formError.set(null);
    this.panel.set(null);
    this.editingId.set(null);
    this.newRateId.set(null);
    this.ending.set(false);
    this.endDate.set(today());
    this.rateFrom.set(today());
    this.amountFrom.set(today());
    this.rateTouched.set(false);
    this.amountTouched.set(false);
    this.name.set('');
    this.debt.set('');
    this.rate.set('');
    this.amount.set('');
    this.rateDate.set('');
    this.rateInterval.set('3');
    this.termsDate.set('');
    this.termsInterval.set('12');
  }

  private submit(call: Observable<MortgageResponse>): void {
    this.formError.set(null);
    this.busy.set(true);
    call.subscribe({
      next: (mortgage) => {
        this.busy.set(false);
        this.mortgage.set(mortgage);
        this.loadFigures();
        this.panel.set(null);
        this.editingId.set(null);
        this.newRateId.set(null);
        this.ending.set(false);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.formError.set(
          (error as { status?: number }).status === 409
            ? 'Det går inte att spara just nu: lånedelen är avslutad, eller så finns redan en notering för det datumet.'
            : 'Det gick inte att spara. Kontrollera uppgifterna och försök igen.',
        );
      },
    });
  }
}
