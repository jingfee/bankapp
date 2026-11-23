import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Disclosure } from './disclosure';

@Component({
  imports: [Disclosure],
  template: `<app-disclosure label="Avslutade konton" [count]="2" [(open)]="open"
    ><p data-content>Innehåll</p></app-disclosure
  >`,
})
class Host {
  readonly open = signal(false);
}

function setup() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const toggle = () => el.querySelector<HTMLButtonElement>('[data-disclosure-toggle]')!;
  return { fixture, el, toggle };
}

describe('Disclosure', () => {
  it('is a closed row with a label and a count', () => {
    const { el, toggle } = setup();

    expect(toggle().textContent).toContain('Avslutade konton');
    expect(el.querySelector('[data-disclosure-count]')?.textContent).toBe('2');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[data-content]')).toBeNull();
  });

  it('opens and closes when the row is clicked, rotating the chevron', () => {
    const { fixture, el, toggle } = setup();

    toggle().click();
    fixture.detectChanges();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('[data-content]')).not.toBeNull();
    expect(el.querySelector('.disclosure-chevron')?.classList).toContain('rotate-180');
    expect(fixture.componentInstance.open()).toBe(true);

    toggle().click();
    fixture.detectChanges();
    expect(el.querySelector('[data-content]')).toBeNull();
  });
});
