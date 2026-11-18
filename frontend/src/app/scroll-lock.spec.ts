import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { lockPageScroll } from './scroll-lock';

@Component({ template: '' })
class Locker {
  constructor() {
    lockPageScroll();
  }
}

describe('lockPageScroll', () => {
  it('stops the page behind scrolling while the component lives, then restores it', () => {
    document.body.style.overflow = 'auto';
    const first = TestBed.createComponent(Locker);
    const second = TestBed.createComponent(Locker);
    expect(document.body.style.overflow).toBe('hidden');

    first.destroy();
    expect(document.body.style.overflow).toBe('hidden');

    second.destroy();
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });
});
