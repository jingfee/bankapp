import { Controller, Get } from '@nestjs/common';
import type { CategoriesResponse } from '@bankapp/shared';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(): CategoriesResponse {
    return { categories: this.categories.list() };
  }
}
