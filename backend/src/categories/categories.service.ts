import { Inject, Injectable } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import type { CategoriesResponse, Category, CategoryIcon } from '@bankapp/shared';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { categories, subcategories } from '../db/schema';

@Injectable()
export class CategoriesService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  /** Every category with its subcategories, both in the owner's order. */
  list(): CategoriesResponse['categories'] {
    const subcategoryRows = this.db
      .select()
      .from(subcategories)
      .orderBy(asc(subcategories.sortOrder), asc(subcategories.id))
      .all();

    return this.db
      .select()
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.id))
      .all()
      .map((category): Category => ({
        id: category.id,
        name: category.name,
        kind: category.kind,
        // Stored as text; the seed and the editing API only ever write palette and icon names.
        colour: category.colour as Category['colour'],
        icon: category.icon as CategoryIcon,
        fixed: category.fixed,
        subcategories: subcategoryRows
          .filter((subcategory) => subcategory.categoryId === category.id)
          .map(({ id, name, icon }) => ({ id, name, icon: icon as CategoryIcon })),
      }));
  }
}
