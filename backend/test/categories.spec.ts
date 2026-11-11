import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CATEGORY_COLOURS,
  CATEGORY_ICONS,
  DEFAULT_CATEGORIES,
  type CategoriesResponse,
} from '@bankapp/shared';
import { createApp } from '../src/app';
import { openDatabase } from '../src/db/database';
import { categories } from '../src/db/schema';
import { FakeEnableBankingClient, testConfig } from './support';

const omitId = <T extends { id: number }>({ id, ...rest }: T): Omit<T, 'id'> => (void id, rest);

describe('categories', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
    });
    await app.init();
  });

  afterEach(() => app.close());

  const getCategories = async (): Promise<CategoriesResponse['categories']> =>
    (
      (await request(app.getHttpServer()).get('/api/categories').expect(200))
        .body as CategoriesResponse
    ).categories;

  it('lists the default categories with their subcategories in order', async () => {
    const listed = await getCategories();

    expect(
      listed.map(({ subcategories, ...category }) => ({
        ...omitId(category),
        subcategories: subcategories.map(({ name, icon }) => ({ name, icon })),
      })),
    ).toEqual(DEFAULT_CATEGORIES);
  });

  it('gives every category and subcategory an icon from the curated set and a palette colour', async () => {
    for (const category of await getCategories()) {
      expect(CATEGORY_COLOURS).toContain(category.colour);
      expect(CATEGORY_ICONS).toContain(category.icon);
      for (const subcategory of category.subcategories) {
        expect(CATEGORY_ICONS).toContain(subcategory.icon);
      }
    }
  });

  it('has exactly one fixed income category and one fixed transfer category', async () => {
    const listed = await getCategories();

    for (const kind of ['income', 'transfer'] as const) {
      const ofKind = listed.filter((category) => category.kind === kind);
      expect(ofKind).toHaveLength(1);
      expect(ofKind[0].fixed).toBe(true);
    }
    expect(listed.filter((category) => category.fixed)).toHaveLength(2);
  });

  it('gives every category an Övrigt subcategory, last', async () => {
    for (const category of await getCategories()) {
      expect(category.subcategories.at(-1)?.name).toBe('Övrigt');
    }
  });

  it('refuses a second income or transfer category', () => {
    const { db, close } = openDatabase({ inMemory: true });

    expect(() =>
      db
        .insert(categories)
        .values({ name: 'Extra', kind: 'income', colour: 'blue', icon: 'wallet', sortOrder: 99 })
        .run(),
    ).toThrow();
    close();
  });
});
