import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CATEGORY_ICONS,
  CATEGORY_PALETTE,
  type CategoryColour,
  type CategoryIcon,
} from '@bankapp/shared';
import { CategoryIconComponent } from './category-icon';
import { LUCIDE_ICONS } from './lucide-icons';

@Component({
  imports: [CategoryIconComponent],
  template: `<app-category-icon
    [icon]="icon()"
    [colour]="colour()"
    [label]="label()"
    [size]="size()"
    [guessed]="guessed()"
    [pending]="pending()"
  />`,
})
class Host {
  readonly icon = signal<CategoryIcon>('house');
  readonly colour = signal<CategoryColour>('orange');
  readonly label = signal<string | undefined>(undefined);
  readonly size = signal<28 | 36 | 40 | 60>(40);
  readonly guessed = signal(false);
  readonly pending = signal(false);
}

describe('CategoryIconComponent', () => {
  function render(): { host: Host; element: HTMLElement } {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { host: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
  }

  it('draws the icon as inline SVG, so no request is needed', () => {
    const { element } = render();

    const paths = [...element.querySelectorAll('svg path')].map((path) => path.getAttribute('d'));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toEqual(
      LUCIDE_ICONS['house']
        .filter(([tag]) => tag === 'path')
        .map(([, attributes]) => attributes['d']),
    );
    expect(element.querySelector('img, image, use, [src], [href]')).toBeNull();
  });

  it('is flat: tinted by its category colour, with a lighter stroke and no light/dark pair', () => {
    const { element } = render();

    const badge = element.querySelector<HTMLElement>('[data-badge]')!;
    expect(badge.style.getPropertyValue('--category-colour')).toBe(CATEGORY_PALETTE.orange.colour);
    expect(badge.style.getPropertyValue('--category-tint')).toBe(CATEGORY_PALETTE.orange.tint);
    expect(badge.classList).toContain('category-icon');
    expect(badge.className).not.toMatch(/shadow|gradient/);
  });

  it('follows its inputs', () => {
    const { host, element } = render();

    host.icon.set('zap');
    host.colour.set('teal');
    TestBed.tick();

    const badge = element.querySelector<HTMLElement>('[data-badge]')!;
    expect(badge.style.getPropertyValue('--category-colour')).toBe(CATEGORY_PALETTE.teal.colour);
    expect(element.querySelector('svg')?.innerHTML).toContain(
      String(LUCIDE_ICONS['zap'][0][1]['d']),
    );
  });

  it('comes in the sizes 28, 36, 40 and 60, 40 by default', () => {
    const { host, element } = render();
    const badge = () => element.querySelector<HTMLElement>('[data-badge]')!;

    expect(badge().style.getPropertyValue('--size')).toBe('40px');
    for (const size of [28, 36, 60] as const) {
      host.size.set(size);
      TestBed.tick();
      expect(badge().style.getPropertyValue('--size')).toBe(`${size}px`);
      expect(badge().querySelector('svg')?.getAttribute('width')).toBe(
        String(Math.round(size * 0.45)),
      );
    }
  });

  it('marks a guess with a "?" badge at every size', () => {
    const { host, element } = render();
    host.guessed.set(true);
    TestBed.tick();

    expect(element.querySelector('[data-badge]')?.classList).toContain('category-icon-guessed');
    expect(element.querySelector('[data-guess-mark]')?.textContent?.trim()).toBe('?');

    for (const size of [28, 36, 60] as const) {
      host.size.set(size);
      TestBed.tick();
      expect(element.querySelector('[data-guess-mark]')).not.toBeNull();
    }
  });

  it('marks a pending transaction with a dashed outline', () => {
    const { host, element } = render();
    expect(element.querySelector('[data-badge]')?.classList).not.toContain('category-icon-pending');

    host.pending.set(true);
    TestBed.tick();
    expect(element.querySelector('[data-badge]')?.classList).toContain('category-icon-pending');
  });

  it('is hidden from assistive technology unless it has a label', () => {
    const { host, element } = render();
    const badge = () => element.querySelector('[data-badge]')!;

    expect(badge().getAttribute('aria-hidden')).toBe('true');
    expect(badge().getAttribute('role')).toBeNull();

    host.label.set('Livsmedel');
    TestBed.tick();

    expect(badge().getAttribute('aria-hidden')).toBeNull();
    expect(badge().getAttribute('role')).toBe('img');
    expect(badge().getAttribute('aria-label')).toBe('Livsmedel');
  });

  it('bundles every icon in the curated set', () => {
    expect(Object.keys(LUCIDE_ICONS).sort()).toEqual([...CATEGORY_ICONS].sort());
  });
});
