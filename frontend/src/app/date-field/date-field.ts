import { Component, type ElementRef, input, output, viewChild } from '@angular/core';

/**
 * A date the owner sees and picks as `yyyy-MM-dd`, whatever the phone's region is.
 * The text is ours; the native date input sits invisibly on top for its picker.
 */
@Component({
  selector: 'app-date-field',
  host: { class: 'relative block' },
  template: `
    <button
      type="button"
      data-date-text
      [class]="fieldClass()"
      [attr.aria-label]="label() || null"
      (click)="open()"
    >
      {{ value() || 'åååå-mm-dd' }}
    </button>
    <input
      #native
      type="date"
      data-date-input
      tabindex="-1"
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      [value]="value()"
      (change)="valueChange.emit(native.value)"
    />
  `,
})
export class DateField {
  /** The date as `yyyy-MM-dd`, or empty. */
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
      // No picker here (old or embedded browser): the owner can still read the date, not change it.
    }
  }
}
