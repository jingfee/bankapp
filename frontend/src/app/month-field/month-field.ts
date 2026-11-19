import { Component, type ElementRef, input, output, viewChild } from '@angular/core';

/**
 * A month the owner sees and picks as `yyyy-MM`, whatever the phone's region is.
 * The text is ours; the native date input sits invisibly on top for its picker.
 */
@Component({
  selector: 'app-month-field',
  host: { class: 'relative block' },
  template: `
    <button
      type="button"
      data-month-text
      [class]="fieldClass()"
      [attr.aria-label]="label() || null"
      (click)="open()"
    >
      {{ value() || 'åååå-mm' }}
    </button>
    <input
      #native
      type="month"
      data-month-native
      tabindex="-1"
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      [value]="value()"
      (change)="valueChange.emit(native.value)"
    />
  `,
})
export class MonthField {
  /** The month as `yyyy-MM`, or empty. */
  readonly value = input('');
  readonly label = input('');
  readonly fieldClass = input('input text-left');
  readonly valueChange = output<string>();

  private readonly native = viewChild.required<ElementRef<HTMLInputElement>>('native');

  protected open(): void {
    const input = this.native().nativeElement;
    try {
      input.showPicker();
    } catch {
      // No picker here (old or embedded browser): the owner can still read the month, not change it.
    }
  }
}
