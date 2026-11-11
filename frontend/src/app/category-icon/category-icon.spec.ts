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
  template: `<app-category-icon [icon]="icon()" [colour]="colour()" [label]="label()" />`,
})
class Host {
  readonly icon = signal<CategoryIcon>('house');
  readonly colour = signal<CategoryColour>('orange');
  readonly label = signal<string | undefined>(undefined);
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

  it('puts the icon on its category colour, for both light and dark mode', () => {
    const { element } = render();

    const badge = element.querySelector<HTMLElement>('[data-badge]')!;
    expect(badge.style.getPropertyValue('--category-light')).toBe(CATEGORY_PALETTE.orange.light);
    expect(badge.style.getPropertyValue('--category-dark')).toBe(CATEGORY_PALETTE.orange.dark);
    expect(badge.className).toContain('bg-(--category-light)');
    expect(badge.className).toContain('dark:bg-(--category-dark)');
  });

  it('follows its inputs', () => {
    const { host, element } = render();

    host.icon.set('zap');
    host.colour.set('teal');
    TestBed.tick();

    const badge = element.querySelector<HTMLElement>('[data-badge]')!;
    expect(badge.style.getPropertyValue('--category-light')).toBe(CATEGORY_PALETTE.teal.light);
    expect(element.querySelector('svg')?.innerHTML).toContain(
      String(LUCIDE_ICONS['zap'][0][1]['d']),
    );
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
