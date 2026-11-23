import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Callout, type CalloutVariant } from './callout';

@Component({
  imports: [Callout],
  template: `<app-callout [variant]="variant()">
    Något hände
    @if (withAction()) {
      <button callout-action type="button">Visa</button>
    }
  </app-callout>`,
})
class Host {
  readonly variant = signal<CalloutVariant>('info');
  readonly withAction = signal(false);
}

function setup() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const callout = () => (fixture.nativeElement as HTMLElement).querySelector('app-callout')!;
  return { fixture, callout };
}

describe('Callout', () => {
  it('shows an icon and the body', () => {
    const { callout } = setup();

    expect(callout().querySelector('svg')).not.toBeNull();
    expect(callout().textContent).toContain('Något hände');
  });

  it('announces warnings and errors, and mentions information politely', () => {
    const { fixture, callout } = setup();
    expect(callout().getAttribute('role')).toBe('status');

    fixture.componentInstance.variant.set('warning');
    fixture.detectChanges();
    expect(callout().getAttribute('role')).toBe('alert');
    expect(callout().classList).toContain('callout-warning');

    fixture.componentInstance.variant.set('danger');
    fixture.detectChanges();
    expect(callout().getAttribute('role')).toBe('alert');
    expect(callout().classList).toContain('callout-danger');
  });

  it('shows the optional action', () => {
    const { fixture, callout } = setup();
    expect(callout().querySelector('button')).toBeNull();

    fixture.componentInstance.withAction.set(true);
    fixture.detectChanges();

    expect(callout().querySelector('button')?.textContent).toBe('Visa');
  });
});
