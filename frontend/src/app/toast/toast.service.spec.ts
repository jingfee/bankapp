import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a message and dismisses it after about 2.5 seconds', () => {
    const toasts = TestBed.inject(ToastService);

    toasts.show('Sparat');
    expect(toasts.message()).toBe('Sparat');

    vi.advanceTimersByTime(2400);
    expect(toasts.message()).toBe('Sparat');
    vi.advanceTimersByTime(200);
    expect(toasts.message()).toBeNull();
  });

  it('lets a newer message replace the old one and restart the timer', () => {
    const toasts = TestBed.inject(ToastService);

    toasts.show('Första');
    vi.advanceTimersByTime(2000);
    toasts.show('Andra');
    vi.advanceTimersByTime(2000);

    expect(toasts.message()).toBe('Andra');
    vi.advanceTimersByTime(600);
    expect(toasts.message()).toBeNull();
  });
});
