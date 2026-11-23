import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ShareOption } from '@bankapp/shared';
import { describe, expect, it } from 'vitest';
import { ShareControl } from './share-control';

@Component({
  imports: [ShareControl],
  template: `<app-share-control
    [value]="value()"
    [householdDisabled]="noRatio()"
    (changed)="picked.push($event)"
  />`,
})
class Host {
  readonly value = signal<ShareOption>('half');
  readonly noRatio = signal(false);
  readonly picked: ShareOption[] = [];
}

function setup() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const button = (option: string) =>
    el.querySelector<HTMLButtonElement>(`button[data-share=${option}]`)!;
  return { fixture, el, button };
}

describe('ShareControl', () => {
  it('lists the four options with the current one pressed', () => {
    const { el } = setup();

    expect([...el.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Jag',
      '50/50',
      'Hushåll',
      'Partner',
    ]);
    expect(el.querySelector('[aria-pressed=true]')?.getAttribute('data-share')).toBe('half');
  });

  it('emits the option that is clicked', () => {
    const { fixture, button } = setup();

    button('partner').click();

    expect(fixture.componentInstance.picked).toEqual(['partner']);
  });

  it('disables Hushåll and explains why when there is no household ratio', async () => {
    const { fixture, el, button } = setup();
    fixture.componentInstance.noRatio.set(true);
    fixture.detectChanges();

    expect(button('household').disabled).toBe(true);
    expect(button('half').disabled).toBe(false);
    expect(el.querySelector('[data-household-note]')?.textContent).toContain('hushållsandel');
    button('household').click();
    expect(fixture.componentInstance.picked).toEqual([]);
  });
});
