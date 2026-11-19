import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MonthField } from './month-field';

@Component({
  imports: [MonthField],
  template: `<app-month-field [value]="date()" (valueChange)="date.set($event)" />`,
})
class Host {
  readonly date = signal('2026-11');
}

describe('MonthField', () => {
  it('shows the date as yyyy-MM and reports a picked date', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-month-text]')!.textContent!.trim()).toBe('2026-11');

    const input = el.querySelector('input')!;
    input.value = '2026-12';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.date()).toBe('2026-12');
    expect(el.querySelector('[data-month-text]')!.textContent!.trim()).toBe('2026-12');
  });

  it('shows a placeholder when empty and opens the native picker on click', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.date.set('');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-month-text]')!.textContent!.trim()).toBe('åååå-mm');

    const showPicker = vi.fn();
    el.querySelector('input')!.showPicker = showPicker;
    (el.querySelector('[data-month-text]') as HTMLButtonElement).click();
    expect(showPicker).toHaveBeenCalled();
  });
});
