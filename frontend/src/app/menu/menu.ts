import {
  Component,
  Directive,
  Injector,
  afterNextRender,
  type ElementRef,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Icon } from '../icon/icon';
import { registerOverlay } from '../overlays';

/** One action in an `<app-menu>`. Destructive actions come last and set `danger`. */
@Directive({
  selector: '[appMenuItem]',
  host: {
    role: 'menuitem',
    tabindex: '-1',
    class: 'menu-item',
    '[class.menu-item-danger]': 'danger()',
  },
})
export class MenuItem {
  readonly danger = input(false);
}

const MOBILE_QUERY = '(max-width: 39.99rem)';

/**
 * A ⋯ button for the secondary and destructive actions of a card or row. The actions open as an
 * action sheet on phones and a popover on desktop. Arrow keys, Home and End move between the
 * actions, Escape closes and returns focus to the button, and picking one closes the menu.
 *
 * The content is `[appMenuItem]` buttons or links. An item that is followed by a confirmation
 * ends its label with "…".
 */
@Component({
  selector: 'app-menu',
  imports: [Icon],
  host: { class: 'relative inline-flex', '(document:keydown.escape)': 'onEscape()' },
  template: `
    <button
      #trigger
      type="button"
      data-menu-trigger
      class="btn btn-ghost btn-sm"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label()"
      (click)="toggle()"
    >
      <app-icon name="ellipsis" [size]="20" />
    </button>
    @if (open()) {
      <button
        type="button"
        data-menu-backdrop
        tabindex="-1"
        aria-hidden="true"
        class="sheet-backdrop fixed inset-0 z-50 cursor-default bg-black/60 sm:bg-transparent"
        (click)="close()"
      ></button>
      <div
        #panel
        role="menu"
        tabindex="-1"
        data-menu
        [attr.aria-label]="label()"
        class="menu-panel border-line-strong bg-surface-2 fixed z-50 flex flex-col gap-1 border p-2"
        [class.sheet]="mobile()"
        [style]="panelStyle()"
        (keydown)="onKeydown($event)"
        (click)="onPanelClick($event)"
      >
        <ng-content />
      </div>
    }
  `,
})
export class Menu {
  /** What the button announces, e.g. "Åtgärder för Lån 1". */
  readonly label = input('Åtgärder');

  protected readonly open = signal(false);
  private readonly anchor = signal<{ top: number; right: number } | null>(null);
  protected readonly mobile = signal(false);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly injector = inject(Injector);
  private overlay: ReturnType<typeof registerOverlay> | null = null;

  protected readonly panelStyle = computed(() => {
    if (this.mobile()) {
      return 'left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom)); border-radius: 20px;';
    }
    const anchor = this.anchor();
    return anchor === null
      ? ''
      : `top: ${anchor.top}px; right: ${anchor.right}px; min-width: 14rem; border-radius: 14px;`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.overlay?.release());
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else this.show();
  }

  private show(): void {
    this.mobile.set(typeof matchMedia === 'function' && matchMedia(MOBILE_QUERY).matches);
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    this.anchor.set({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    this.overlay = registerOverlay();
    this.open.set(true);
    // The panel exists after the next render; the first action takes focus then.
    afterNextRender(() => this.items().at(0)?.focus(), { injector: this.injector });
  }

  protected close(returnFocus = true): void {
    if (!this.open()) return;
    this.open.set(false);
    this.overlay?.release();
    this.overlay = null;
    if (returnFocus) this.trigger().nativeElement.focus();
  }

  protected onEscape(): void {
    if (this.open() && this.overlay?.isTop()) this.close();
  }

  protected onPanelClick(event: Event): void {
    if ((event.target as HTMLElement).closest('[role="menuitem"]') !== null) this.close();
  }

  private items(): HTMLElement[] {
    return Array.from(
      this.panel()?.nativeElement.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      ) ?? [],
    );
  }

  protected onKeydown(event: KeyboardEvent): void {
    const items = this.items();
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = at === -1 ? 0 : (at + 1) % items.length;
        break;
      case 'ArrowUp':
        next = at === -1 ? items.length - 1 : (at - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Tab':
        // Leaving the menu with Tab closes it rather than stranding focus behind the backdrop.
        this.close();
        return;
      default:
        return;
    }
    event.preventDefault();
    items[next]?.focus();
  }
}
