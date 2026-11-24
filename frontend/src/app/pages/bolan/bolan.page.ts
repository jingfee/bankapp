import { ShortDatePipe } from '../../formatting/short-date.pipe';
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
import { type Observable, concat, last } from 'rxjs';
import { Callout } from '../../callout/callout';
import { Confirm } from '../../confirm/confirm';
import { Menu, MenuItem } from '../../menu/menu';
import { Sheet } from '../../sheet/sheet';
import { Disclosure } from '../../disclosure/disclosure';
import { Icon } from '../../icon/icon';
import { DateField } from '../../date-field/date-field';
import { today } from '../../dates';
import { formatAmountInput, parseAmount } from '../../formatting/amount';
import {
  ChartCard,
  type ChartColumn,
  type ChartLegendItem,
  type ChartTip,
} from '../../chart-card/chart-card';
import { monthTicks } from '../../chart-card/month-ticks';
import { MoneyPipe } from '../../formatting/money.pipe';
import { APP_LOCALE } from '../../formatting/locale';
import { MortgageStore } from '../../stores/mortgage.store';
import { Page } from '../../page/page';
import { Skeleton } from '../../skeleton/skeleton';
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
const money = new MoneyPipe();
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
  imports: [
    ChartCard,
    ShortDatePipe,
    Page,
    DateField,
    MoneyPipe,
    NgTemplateOutlet,
    RouterLink,
    Callout,
    Confirm,
    Disclosure,
    Icon,
    Menu,
    MenuItem,
    Sheet,
    Skeleton,
  ],
  template: `
    <app-page title="Bolån">
      @if (failed(); as message) {
        <app-callout variant="danger">{{ message }}</app-callout>
      }

      @if (!loaded()) {
        <div aria-busy="true" class="flex flex-col gap-4">
          <app-skeleton shape="tiles" [count]="3" />
          <app-skeleton shape="card" />
        </div>
      } @else if (parts().length === 0) {
        <section class="card flex flex-col gap-3 p-4 sm:p-5" data-intro>
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
              <app-icon name="plus" [size]="16" />
              Lägg till bolån
            </button>
          </div>
        </section>
      }

      @if (openParts().length > 0) {
        <section
          class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3"
          data-summary
        >
          <div class="stat-tile">
            <span class="eyebrow">Kvarvarande skuld</span>
            <span data-total-debt class="amount text-[17px] whitespace-nowrap sm:text-[21px]">{{
              summary().debt | money
            }}</span>
          </div>
          <div class="stat-tile">
            <span class="eyebrow">Snittränta</span>
            <span data-average-rate class="amount text-[17px] whitespace-nowrap sm:text-[21px]">{{
              summary().rate === null ? '–' : percent(summary().rate!)
            }}</span>
          </div>
          <div class="stat-tile">
            <span class="eyebrow">Beräknad månadsbetalning</span>
            @if (estimate(); as e) {
              <span data-estimate class="amount text-[17px] whitespace-nowrap sm:text-[21px]">{{
                e.total | money
              }}</span>
              <span class="text-xs leading-snug text-muted">
                Ränta <span data-estimate-interest class="amount">{{ e.interest | money }}</span> ·
                Amortering
                <span data-estimate-amortisation class="amount">{{ e.amortisation | money }}</span>
              </span>
            } @else {
              <span data-estimate class="amount text-[17px] whitespace-nowrap sm:text-[21px]"
                >–</span
              >
            }
          </div>
        </section>

        @if (unpaidMonths(); as unpaid) {
          @if (unpaid.length > 0) {
            <app-callout data-no-payment variant="info">
              Ingen bolånebetalning hittad i {{ unpaid.length }}
              {{ unpaid.length === 1 ? 'månad' : 'månader' }}
              <button
                callout-action
                type="button"
                data-no-payment-toggle
                class="btn btn-ghost btn-sm"
                [attr.aria-expanded]="showUnpaid()"
                (click)="showUnpaid.set(!showUnpaid())"
              >
                {{ showUnpaid() ? 'Dölj' : 'Visa' }}
              </button>
              @if (showUnpaid()) {
                <ul class="mt-2 flex flex-col gap-1">
                  @for (month of unpaid; track month.month) {
                    <li>
                      <a
                        data-no-payment-link
                        class="font-medium text-accent"
                        routerLink="/transaktioner"
                        [queryParams]="month.params"
                        >{{ month.name }} →</a
                      >
                    </li>
                  }
                </ul>
              }
            </app-callout>
          }
        }
      }

      @if (chartMonths().length > 0) {
        <app-chart-card
          data-chart-card
          [title]="mode() === 'debt' ? 'Kvarvarande skuld' : 'Beräknat vs Betalt'"
          [yTicks]="yTicks()"
          [xTicks]="xTicks()"
          [columns]="columns()"
          [tip]="tip()"
          [legend]="legend()"
          (hovered)="hovered.set($event)"
        >
          <ng-container chart-controls>
            <div class="segmented" role="group" aria-label="Diagram">
              <button
                type="button"
                data-mode="debt"
                [attr.aria-pressed]="mode() === 'debt'"
                (click)="mode.set('debt'); hovered.set(null)"
              >
                Skuld
              </button>
              <button
                type="button"
                data-mode="paid"
                [attr.aria-pressed]="mode() === 'paid'"
                (click)="mode.set('paid'); hovered.set(null)"
              >
                Beräknat vs Betalt
              </button>
            </div>
            <div class="segmented" role="group" aria-label="Period">
              @for (option of ranges; track option.id) {
                <button
                  type="button"
                  [attr.data-range]="option.id"
                  [attr.aria-pressed]="range() === option.id"
                  (click)="range.set(option.id); hovered.set(null)"
                >
                  {{ option.label }}
                </button>
              }
            </div>
          </ng-container>
          @if (chart(); as c) {
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
          }
        </app-chart-card>
      }

      <section class="card flex flex-col gap-4 p-4 sm:p-5" data-mortgage>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="card-title">Lånedelar</h2>
          <div class="flex flex-wrap gap-2">
            @if (openParts().length > 0) {
              <button
                type="button"
                data-new-entry
                class="btn btn-sm btn-secondary"
                (click)="startEntry(null)"
              >
                <app-icon name="plus" [size]="16" />
                Ny bolånenotering
              </button>
            }
            <button
              type="button"
              data-add-part
              class="btn btn-sm btn-secondary"
              (click)="startAddPart()"
            >
              <app-icon name="plus" [size]="16" />
              {{ parts().length === 0 ? 'Lägg till bolån' : 'Lägg till lånedel' }}
            </button>
          </div>
        </div>

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
                        >{{ part.rateAdjustment.next | shortDate }}</span
                      >
                      @if (countdown(part.rateAdjustment.next).text; as text) {
                        <span data-rate-soon class="pill pill-accent ml-1.5">{{ text }}</span>
                      }
                    </span>
                    <span>
                      Villkorsändring
                      <span
                        data-terms-day
                        [class.text-accent]="countdown(part.termsChange.next).soon"
                        [class.font-medium]="countdown(part.termsChange.next).soon"
                        >{{ part.termsChange.next | shortDate }}</span
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
                      <button
                        type="button"
                        data-new-rate
                        class="btn btn-sm btn-secondary"
                        (click)="startNewRate(part)"
                      >
                        Ny ränta
                      </button>
                    </div>
                  }
                </div>
                @if (!part.endedOn) {
                  <app-menu [label]="'Åtgärder för ' + part.name">
                    <button appMenuItem type="button" data-edit (click)="startEdit(part)">
                      Ändra
                    </button>
                    <button
                      appMenuItem
                      type="button"
                      data-new-rate-item
                      (click)="startNewRate(part)"
                    >
                      Ny ränta
                    </button>
                    <button
                      appMenuItem
                      type="button"
                      data-end
                      [danger]="true"
                      (click)="startEnd(part)"
                    >
                      Avsluta lånedel…
                    </button>
                  </app-menu>
                }
              </div>
            </li>
          }
        </ul>

        @if (endedParts().length > 0) {
          <app-disclosure
            data-ended-parts
            label="Avslutade lånedelar"
            [count]="endedParts().length"
          >
            <ul class="flex flex-col divide-y divide-line">
              @for (part of endedParts(); track part.id) {
                <li
                  class="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
                  [attr.data-part]="part.id"
                >
                  <span data-part-name class="truncate font-medium">{{ part.name }}</span>
                  <span data-ended class="text-sm text-muted">
                    {{ part.startedOn | shortDate }} – {{ part.endedOn | shortDate }}
                  </span>
                </li>
              }
            </ul>
          </app-disclosure>
        }
      </section>

      @if (entries().length > 0) {
        <section class="card flex flex-col gap-3 p-4 sm:p-5">
          <h2 class="card-title">Noteringar</h2>
          <ul class="flex flex-col divide-y divide-line text-sm" data-entries>
            @for (entry of entries(); track entry.id) {
              <li class="flex items-start justify-between gap-3 py-2" data-entry>
                <span class="flex min-w-0 flex-wrap gap-x-3">
                  <span data-entry-day>{{ entry.date | shortDate }}</span>
                  @for (debt of entry.debts; track debt.partId) {
                    <span class="text-muted">
                      {{ partName(debt.partId) }}
                      <span class="amount">{{ debt.debt | money }}</span>
                    </span>
                  }
                </span>
                <app-menu [label]="'Åtgärder för noteringen ' + (entry.date | shortDate)">
                  <button appMenuItem type="button" data-edit-entry (click)="startEntry(entry)">
                    Ändra
                  </button>
                  <button
                    appMenuItem
                    type="button"
                    data-delete-entry
                    [danger]="true"
                    [disabled]="busy()"
                    (click)="deletingEntry.set(entry)"
                  >
                    Ta bort…
                  </button>
                </app-menu>
              </li>
            }
          </ul>
        </section>
      }
    </app-page>

    @if (panel()?.kind === 'add-part') {
      <app-sheet
        data-part-form
        [heading]="parts().length === 0 ? 'Lägg till bolån' : 'Lägg till lånedel'"
        [dismissible]="!busy()"
        (closed)="cancel()"
        (submitted)="addPart()"
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm text-muted sm:col-span-2">
            Namn
            <span class="field"
              ><input
                data-name
                data-autofocus
                class="field-control"
                placeholder="Del 1 – 3 mån"
                [value]="name()"
                (input)="name.set(value($event))"
            /></span>
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
        @if (formError(); as message) {
          <app-callout data-form-error variant="danger">{{ message }}</app-callout>
        }
        <ng-container sheet-footer>
          <button type="button" data-cancel class="btn btn-ghost" (click)="cancel()">Avbryt</button>
          <button type="submit" data-save class="btn btn-primary flex-1" [disabled]="busy()">
            Spara lånedel
          </button>
        </ng-container>
      </app-sheet>
    }

    @if (newRatePart(); as part) {
      <app-sheet
        data-new-rate-form
        [heading]="'Ny ränta för ' + part.name"
        [dismissible]="!busy()"
        (closed)="cancel()"
        (submitted)="saveNewRate(part)"
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm text-muted">
            Ny ränta
            <span class="field">
              <input
                data-rate
                data-autofocus
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
        @if (formError(); as message) {
          <app-callout data-form-error variant="danger">{{ message }}</app-callout>
        }
        <ng-container sheet-footer>
          <button type="button" data-cancel class="btn btn-ghost" (click)="cancel()">Avbryt</button>
          <button type="submit" data-save class="btn btn-primary flex-1" [disabled]="busy()">
            Spara ränta
          </button>
        </ng-container>
      </app-sheet>
    }

    @if (editingPart(); as part) {
      <app-sheet
        data-part-panel
        [heading]="'Ändra ' + part.name"
        [dismissible]="!busy()"
        (closed)="cancel()"
        (submitted)="saveEdit(part)"
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm text-muted sm:col-span-2">
            Namn
            <span class="field"
              ><input
                data-name
                data-autofocus
                class="field-control"
                [value]="name()"
                (input)="name.set(value($event))"
            /></span>
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
          Ränta och amortering sparas som en ny ändring bara om du rör dem. Samma ränta igen noteras
          också.
        </p>
        @if (formError(); as message) {
          <app-callout data-form-error variant="danger">{{ message }}</app-callout>
        }
        <ng-container sheet-footer>
          <button type="button" data-cancel class="btn btn-ghost" (click)="cancel()">Avbryt</button>
          <button type="submit" data-save class="btn btn-primary flex-1" [disabled]="busy()">
            Spara
          </button>
        </ng-container>
      </app-sheet>
    }

    @if (panel(); as open) {
      @if (open.kind === 'entry') {
        <app-sheet
          data-entry-form
          [heading]="open.entry ? 'Ändra bolånenotering' : 'Ny bolånenotering'"
          [dismissible]="!busy()"
          (closed)="cancel()"
          (submitted)="saveEntry()"
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
          @if (formError(); as message) {
            <app-callout data-form-error variant="danger">{{ message }}</app-callout>
          }
          <ng-container sheet-footer>
            <button type="button" data-cancel class="btn btn-ghost" (click)="cancel()">
              Avbryt
            </button>
            <button type="submit" data-save class="btn btn-primary flex-1" [disabled]="busy()">
              Spara notering
            </button>
          </ng-container>
        </app-sheet>
      }
    }

    @if (deletingEntry(); as entry) {
      <app-confirm
        heading="Ta bort bolånenoteringen?"
        [message]="'Noteringen ' + (entry.date | shortDate) + ' tas bort.'"
        confirmLabel="Ta bort"
        [busy]="busy()"
        (confirmed)="deleteEntry(entry)"
        (cancelled)="deletingEntry.set(null)"
      />
    }

    @if (endingPart(); as part) {
      <app-confirm
        [heading]="'Avsluta ' + part.name + '?'"
        message="Lånedelen räknas inte längre med i skulden och ränteberäkningen från och med dagen den avslutades."
        confirmLabel="Avsluta lånedelen"
        [busy]="busy()"
        (confirmed)="endPart(part)"
        (cancelled)="endingPart.set(null)"
      >
        <label class="flex flex-col gap-1 text-sm text-muted">
          Avslutad den
          <app-date-field data-end-date [value]="endDate()" (valueChange)="endDate.set($event)" />
        </label>
        @if (formError(); as message) {
          <app-callout data-form-error variant="danger">{{ message }}</app-callout>
        }
      </app-confirm>
    }

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
  `,
})
export class BolanPage {
  private readonly store = inject(MortgageStore);
  private readonly now = today();
  private readonly mortgageRead = this.store.mortgage();
  private readonly figuresRead = this.store.figures();

  protected readonly mortgage = computed<MortgageResponse>(
    () => this.mortgageRead.value() ?? { parts: [], entries: [] },
  );
  /** The mortgage has arrived (or failed to), so the page can stop showing placeholders. */
  protected readonly loaded = computed(
    () => !this.mortgageRead.loading() || this.mortgageRead.failed(),
  );
  protected readonly parts = computed(() => this.mortgage().parts);
  protected readonly entries = computed(() => this.mortgage().entries);
  protected readonly openParts = computed(() => this.parts().filter((part) => !part.endedOn));
  protected readonly endedParts = computed(() => this.parts().filter((part) => part.endedOn));
  protected readonly figures = computed<MortgageFiguresResponse>(
    () =>
      this.figuresRead.value() ?? {
        debts: [],
        months: [],
        monthsWithoutPayment: [],
        paymentsSubcategoryId: null,
      },
  );
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
        ...(this.figures().paymentsSubcategoryId === null
          ? {}
          : { subcategories: String(this.figures().paymentsSubcategoryId) }),
      },
    })),
  );

  protected readonly showUnpaid = signal(false);

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
    const months = this.chartMonths().map((m) => m.month);
    return monthTicks(months, (i) => ((i + 0.5) / months.length) * 100);
  });

  protected readonly yTicks = computed(() =>
    (this.chart()?.yTicks ?? []).map((tick) => ({ pct: tick.pct, label: this.kr(tick.value) })),
  );

  protected readonly columns = computed<ChartColumn[]>(() => {
    const slots = this.chart()?.slots ?? [];
    return slots.map((slot, i) => ({
      key: slot.month,
      left: (i / slots.length) * 100,
      width: 100 / slots.length,
    }));
  });

  protected readonly legend = computed<ChartLegendItem[]>(() =>
    this.mode() === 'paid'
      ? [
          { label: 'Beräknat', colour: this.colours().get('estimate')!, kind: 'fill' },
          { label: 'Betalt', colour: this.colours().get('paid')!, kind: 'fill' },
        ]
      : this.parts()
          .filter((part) =>
            this.chartMonths().some((m) => m.debts.some((d) => d.partId === part.id)),
          )
          .map((part) => ({
            label: part.name,
            colour: this.colours().get(part.id)!,
            kind: 'fill' as const,
          })),
  );

  protected readonly tip = computed<ChartTip | null>(() => {
    const c = this.chart();
    const index = this.hovered();
    const month = index === null ? undefined : this.chartMonths()[index];
    if (c === null || month === undefined || index === null) return null;
    const title = `${MONTH_LONG.format(monthDate(month.month))} ${month.month.slice(0, 4)}`;
    const rows =
      this.mode() === 'debt'
        ? month.debts.map((d) => ({
            label: this.partName(d.partId),
            colour: this.colours().get(d.partId)!,
            amount: money.transform(d.debt),
          }))
        : [
            {
              label: 'Beräknat',
              colour: this.colours().get('estimate')!,
              amount: money.transform(month.total),
            },
            {
              label: 'Betalt',
              colour: this.colours().get('paid')!,
              amount: money.transform(month.paid),
            },
          ];
    return { title, rows, pct: ((index + 0.5) / this.chartMonths().length) * 100 };
  });
  /** Why removing an entry failed; saving reports in the form instead. */
  private readonly actionFailed = signal<string | null>(null);
  protected readonly failed = computed(
    () =>
      this.actionFailed() ??
      (this.mortgageRead.error() !== undefined
        ? 'Bolånet kunde inte hämtas. Försök igen senare.'
        : this.figuresRead.error() !== undefined
          ? 'Bolånets siffror kunde inte hämtas. Försök igen senare.'
          : null),
  );
  protected readonly busy = signal(false);
  protected readonly panel = signal<Panel | null>(null);
  protected readonly formError = signal<string | null>(null);

  protected readonly name = signal('');
  protected readonly date = signal(today());
  protected readonly editingId = signal<number | null>(null);
  /** The part the owner is ending, awaiting confirmation with a date. */
  protected readonly endingPart = signal<LoanPart | null>(null);
  /** The entry the owner is removing, awaiting confirmation. */
  protected readonly deletingEntry = signal<MortgageEntry | null>(null);
  protected readonly newRatePart = computed(
    () => this.parts().find((part) => part.id === this.newRateId()) ?? null,
  );
  protected readonly editingPart = computed(
    () => this.parts().find((part) => part.id === this.editingId()) ?? null,
  );
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
    this.submit(this.store.addRateChange(part.id, { from: this.rateFrom(), rate }));
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
      this.store.addPart({
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
      this.store.updatePart(part.id, { name: this.name().trim(), ...days }),
    ];
    if (this.rateTouched()) {
      const rate = parseAmount(this.rate());
      if (rate === null || rate < 0)
        return this.formError.set('Ange räntan i procent, t.ex. 3,85.');
      if (this.rateFrom() === '')
        return this.formError.set('Ange från vilket datum räntan gäller.');
      calls.push(this.store.addRateChange(part.id, { from: this.rateFrom(), rate }));
    }
    if (this.amountTouched()) {
      const amount = parseAmount(this.amount());
      if (amount === null || amount < 0) {
        return this.formError.set('Ange amorteringen som ett belopp, 0 eller mer.');
      }
      if (this.amountFrom() === '') {
        return this.formError.set('Ange från vilket datum amorteringen gäller.');
      }
      calls.push(this.store.addAmortisationChange(part.id, { from: this.amountFrom(), amount }));
    }
    this.submit(concat(...calls).pipe(last()));
  }

  protected startEnd(part: LoanPart): void {
    this.reset();
    this.endingPart.set(part);
  }

  protected endPart(part: LoanPart): void {
    if (this.endDate() === '' || this.endDate() > today()) {
      return this.formError.set('Ange ett datum som inte ligger i framtiden.');
    }
    this.submit(this.store.endPart(part.id, { date: this.endDate() }));
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
      open.entry ? this.store.updateEntry(open.entry.id, request) : this.store.addEntry(request),
    );
  }

  protected deleteEntry(entry: MortgageEntry): void {
    this.busy.set(true);
    this.actionFailed.set(null);
    this.store.deleteEntry(entry.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.actionFailed.set(null);
        this.deletingEntry.set(null);
      },
      error: () => {
        this.busy.set(false);
        this.deletingEntry.set(null);
        this.actionFailed.set('Noteringen kunde inte tas bort. Försök igen senare.');
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
    this.endingPart.set(null);
    this.deletingEntry.set(null);
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
    this.actionFailed.set(null);
    this.busy.set(true);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.panel.set(null);
        this.editingId.set(null);
        this.newRateId.set(null);
        this.endingPart.set(null);
        this.deletingEntry.set(null);
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
