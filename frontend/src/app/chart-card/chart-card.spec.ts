import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ChartCard, type ChartTip } from './chart-card';

@Component({
  imports: [ChartCard],
  template: `<app-chart-card
    title="Saldo"
    [yTicks]="[{ label: '0 kr', pct: 0 }]"
    [xTicks]="[{ label: 'nov', pct: 0 }]"
    [columns]="columns"
    [tip]="tip()"
    [legend]="[
      { label: 'A', colour: 'red', kind: 'fill' },
      { label: 'B', colour: 'blue', kind: 'dashed' },
    ]"
    (hovered)="hovered.set($event)"
  >
    <span chart-controls data-controls>Kontroller</span>
    <svg data-drawing viewBox="0 0 300 120"></svg>
  </app-chart-card>`,
})
class Host {
  readonly columns = [
    { key: 'a', left: 0, width: 50 },
    { key: 'b', left: 50, width: 50 },
  ];
  readonly tip = signal<ChartTip | null>(null);
  readonly hovered = signal<number | null | undefined>(undefined);
}

function setup() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  return { fixture, root };
}

describe('ChartCard', () => {
  it('shows the title, controls, drawing, axes and legend', () => {
    const { root } = setup();

    expect(root.querySelector('h2')?.textContent).toBe('Saldo');
    expect(root.querySelector('[data-controls]')).not.toBeNull();
    expect(root.querySelector('[data-chart-plot] [data-drawing]')).not.toBeNull();
    expect(root.querySelector('[data-y-tick]')?.textContent).toBe('0 kr');
    expect(root.querySelector('[data-x-tick]')?.textContent).toBe('nov');
    expect(root.querySelector('[data-legend]')?.textContent).toContain('A');
    expect(root.querySelector('[data-legend]')?.textContent).toContain('B');
  });

  it('reports the hovered column and when the pointer leaves', () => {
    const { fixture, root } = setup();

    root.querySelector('[data-chart-column="b"]')!.dispatchEvent(new Event('pointerenter'));
    expect(fixture.componentInstance.hovered()).toBe(1);

    root.querySelector('[data-chart-plot]')!.dispatchEvent(new Event('pointerleave'));
    expect(fixture.componentInstance.hovered()).toBeNull();
  });

  it('shows the tooltip rows, a rule above a separated row and the markers', () => {
    const { fixture, root } = setup();
    expect(root.querySelector('[data-chart-tooltip]')).toBeNull();

    fixture.componentInstance.tip.set({
      pct: 50,
      title: 'november 2026',
      rows: [
        { label: 'Konto', amount: '100 kr', colour: 'red' },
        { label: 'Totalt', amount: '100 kr', separated: true },
      ],
      markers: [{ top: 20, colour: 'red' }],
    });
    fixture.detectChanges();

    const tooltip = root.querySelector('[data-chart-tooltip]')!;
    expect(tooltip.textContent).toContain('november 2026');
    expect(tooltip.textContent).toContain('Totalt');
    expect(tooltip.querySelectorAll('.border-t')).toHaveLength(1);
    expect(root.querySelectorAll('[data-chart-plot] > span.rounded-full')).toHaveLength(1);
  });
});
