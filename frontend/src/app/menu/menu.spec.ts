import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Menu, MenuItem } from './menu';

@Component({
  imports: [Menu, MenuItem],
  template: `<app-menu label="Åtgärder för Lån">
    <button appMenuItem data-edit (click)="picked.push('edit')">Ändra</button>
    <button appMenuItem [danger]="true" data-remove (click)="picked.push('remove')">
      Ta bort…
    </button>
  </app-menu>`,
})
class Host {
  picked: string[] = [];
}

describe('Menu', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }
  const trigger = () => document.querySelector('[data-menu-trigger]') as HTMLButtonElement;
  const menu = () => document.querySelector('[role="menu"]') as HTMLElement;
  const items = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const key = (target: HTMLElement, name: string) =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );

  afterEach(() => document.body.replaceChildren());

  it('announces as a menu button and opens a menu with its items', async () => {
    const fixture = render();
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-label')).toBe('Åtgärder för Lån');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(menu()).toBeNull();

    trigger().click();
    fixture.detectChanges();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(items().map((i) => i.textContent?.trim())).toEqual(['Ändra', 'Ta bort…']);
    expect(items()[1]?.classList.contains('menu-item-danger')).toBe(true);
  });

  it('focuses the first item and moves with the arrow keys, Home and End', async () => {
    const fixture = render();
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0] as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1] as HTMLElement, 'Home');
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0] as HTMLElement, 'End');
    expect(document.activeElement).toBe(items()[1]);
  });

  it('closes on Escape and returns focus to the button', () => {
    const fixture = render();
    trigger().click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on the backdrop', () => {
    const fixture = render();
    trigger().click();
    fixture.detectChanges();
    (document.querySelector('[data-menu-backdrop]') as HTMLElement).click();
    fixture.detectChanges();
    expect(menu()).toBeNull();
  });

  it('runs the picked action and closes', () => {
    const fixture = render();
    trigger().click();
    fixture.detectChanges();
    (document.querySelector('[data-remove]') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.picked).toEqual(['remove']);
    expect(menu()).toBeNull();
  });
});
