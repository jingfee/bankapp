import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CategoriesService } from './categories.service';

const response = {
  categories: [
    {
      id: 1,
      name: 'Mat',
      subcategories: [
        { id: 10, name: 'Livsmedel' },
        { id: 11, name: 'Fika' },
      ],
    },
    { id: 2, name: 'Hem', subcategories: [{ id: 20, name: 'Hyra' }] },
  ],
};

describe('CategoriesService', () => {
  let service: CategoriesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CategoriesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('requests the categories once however often and by whoever they are asked for', () => {
    const seen: unknown[] = [];
    service.list().subscribe((c) => seen.push(c));
    service.list().subscribe((c) => seen.push(c));
    service.subcategories().subscribe((c) => seen.push(c));
    http.expectOne('/api/categories').flush(response);
    service.list().subscribe((c) => seen.push(c));
    expect(seen).toHaveLength(4);
  });

  it('flattens the subcategories with the category each belongs to', () => {
    let flat: { category: { id: number }; subcategory: { id: number } }[] = [];
    service.subcategories().subscribe((s) => (flat = s as never));
    http.expectOne('/api/categories').flush(response);
    expect(flat.map((s) => [s.category.id, s.subcategory.id])).toEqual([
      [1, 10],
      [1, 11],
      [2, 20],
    ]);
  });

  it('asks again after a failure', () => {
    service.list().subscribe({ error: () => undefined });
    http.expectOne('/api/categories').flush(null, { status: 500, statusText: 'x' });
    service.list().subscribe();
    http.expectOne('/api/categories').flush(response);
  });
});
