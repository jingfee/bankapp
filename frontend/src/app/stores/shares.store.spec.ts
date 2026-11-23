import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SharesStore } from './shares.store';

describe('SharesStore activation', () => {
  it('stays active while any page still shows the shares', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const store = TestBed.inject(SharesStore);
    const http = TestBed.inject(HttpTestingController);
    const settle = async () => {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve));
      TestBed.tick();
    };

    store.activate();
    // The next page opens before the previous one closes.
    store.activate();
    store.deactivate();
    await settle();

    http
      .expectOne('/api/household-ratio')
      .flush({ entries: [{ from: '2026-01-01', percent: 60 }] });
    http.expectOne('/api/subcategory-shares').flush({ shares: [] });
    await settle();
    expect(store.householdRatio()).toHaveLength(1);

    store.deactivate();
    await settle();
    expect(store.householdRatio()).toBeUndefined();
    http.verify();
  });
});
