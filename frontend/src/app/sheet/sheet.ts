import {
  Component,
  DestroyRef,
  ElementRef,
  type OnInit,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Icon } from '../icon/icon';
import { registerOverlay } from '../overlays';
import { lockPageScroll } from '../scroll-lock';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export type SheetSize = 'dialog' | 'small' | 'panel';

/**
 * The shell every form, filter and confirmation opens in: a bottom sheet on phones (handle, title,
 * icon close, scrolling body, sticky footer) and a centred dialog on desktop; `size="panel"` keeps
 * a right-hand panel on desktop. It traps focus, closes on Escape and backdrop, returns focus to
 * what opened it and sits above the tab bar.
 *
 * Slots: the content is the scrolling body; `[sheet-footer]` is the sticky footer. Everything is
 * inside one form, so a button of type submit (or Enter in a field) emits `submitted`.
 *
 * Focus goes to the first `[data-autofocus]` element in the body, else to the dialog itself.
 */
@Component({
  selector: 'app-sheet',
  imports: [Icon],
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    <button
      type="button"
      data-backdrop
      tabindex="-1"
      aria-hidden="true"
      [class.sheet-backdrop]="!entered()"
      class="fixed inset-0 z-50 cursor-default bg-black/60"
      (click)="dismiss()"
    ></button>
    <div
      #dialog
      [attr.role]="dialogRole()"
      aria-modal="true"
      [attr.aria-label]="heading()"
      tabindex="-1"
      data-sheet
      [attr.data-size]="size()"
      [class.modal-sheet]="!entered() && size() !== 'panel'"
      [class.sheet]="!entered() && size() === 'panel'"
      (animationend)="$event.target === $event.currentTarget && entered.set(true)"
      (keydown)="trapFocus($event)"
      class="bg-surface-1 border-line-strong fixed z-50 flex flex-col border outline-none"
      [class]="shell()"
    >
      <div
        aria-hidden="true"
        class="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong sm:hidden"
      ></div>
      <header class="flex items-center justify-between gap-3 px-5 pt-3 pb-2 sm:pt-4">
        <h2 data-title class="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">
          {{ heading() }}
        </h2>
        <button
          type="button"
          data-close
          aria-label="Stäng"
          class="btn btn-ghost"
          (click)="dismiss()"
        >
          <app-icon name="x" />
        </button>
      </header>
      <form
        data-form
        novalidate
        class="flex min-h-0 flex-1 flex-col"
        (submit)="$event.preventDefault(); submitted.emit()"
      >
        <div
          data-sheet-body
          class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 py-3"
        >
          <ng-content />
        </div>
        <footer data-sheet-footer class="border-line flex gap-3 border-t px-5 py-4 empty:hidden">
          <ng-content select="[sheet-footer]" />
        </footer>
      </form>
    </div>
  `,
})
export class Sheet implements OnInit {
  readonly heading = input.required<string>();
  readonly size = input<SheetSize>('dialog');
  readonly dialogRole = input<'dialog' | 'alertdialog'>('dialog');
  /** False while something is being saved: Escape, the backdrop and the close button do nothing. */
  readonly dismissible = input(true);

  /** The owner dismissed the sheet (Escape, backdrop or the close button). */
  readonly closed = output<void>();
  /** The form in the sheet was submitted. */
  readonly submitted = output<void>();

  /** The enter animation plays once; a restart while a date picker is open would strand the sheet. */
  protected readonly entered = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly opener = document.activeElement;
  private readonly overlay = registerOverlay();

  protected shell(): string {
    switch (this.size()) {
      case 'panel':
        return 'inset-x-0 bottom-0 h-[90dvh] rounded-t-3xl sm:top-3 sm:right-3 sm:bottom-3 sm:left-auto sm:h-auto sm:w-[420px] sm:rounded-3xl';
      case 'small':
        return 'inset-x-0 bottom-0 max-h-[calc(100dvh-36px)] rounded-t-3xl sm:inset-x-0 sm:top-[15vh] sm:bottom-auto sm:mx-auto sm:max-h-[calc(100dvh-3rem)] sm:w-[440px] sm:max-w-[calc(100vw-2rem)] sm:rounded-3xl';
      default:
        return 'inset-x-0 bottom-0 max-h-[calc(100dvh-36px)] rounded-t-3xl sm:inset-x-0 sm:top-6 sm:bottom-auto sm:mx-auto sm:max-h-[calc(100dvh-3rem)] sm:w-[560px] sm:max-w-[calc(100vw-2rem)] sm:rounded-3xl';
    }
  }

  constructor() {
    lockPageScroll();
    inject(DestroyRef).onDestroy(() => {
      this.overlay.release();
      // Moved to <body>, so removing the parent's view does not remove it.
      this.host.remove();
      if (this.opener instanceof HTMLElement && this.opener.isConnected) this.opener.focus();
    });
    // Focus moves into the sheet once its content is there.
    effect(() => {
      const dialog = this.dialog().nativeElement;
      const target = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog;
      target.focus();
    });
  }

  ngOnInit(): void {
    // The sheet is positioned against the window, so it must not sit inside the routed page:
    // that page is animated, and a fixed element inside it moves with the page's scroll.
    document.body.append(this.host);
  }

  protected onEscape(): void {
    if (this.overlay.isTop()) this.dismiss();
  }

  protected dismiss(): void {
    if (this.dismissible()) this.closed.emit();
  }

  /** Keeps Tab and Shift+Tab inside the sheet. */
  protected trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      this.dialog().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === this.dialog().nativeElement)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
