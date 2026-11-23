import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Empty } from './empty';

@Component({
  imports: [Empty],
  template: `<app-empty icon="landmark" text="Inga banker anslutna">
    @if (withAction()) {
      <a empty-action href="/anslut-bank">Anslut bank</a>
    }
  </app-empty>`,
})
class Host {
  readonly withAction = signal(true);
}

describe('Empty', () => {
  it('shows an icon, the sentence and the next action', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('[data-empty-text]')?.textContent).toBe('Inga banker anslutna');
    expect(el.querySelector('a')?.textContent).toBe('Anslut bank');
  });

  it('has no action when there is none to offer', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.withAction.set(false);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('a')).toBeNull();
  });
});
