import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CategorisingController } from './categorising.controller';
import { Categorising } from './guessing/categorising';
import { CategoryGuesser } from './guessing/category-guesser';

@Module({
  controllers: [CategoriesController, CategorisingController],
  providers: [CategoriesService, CategoryGuesser, Categorising],
  exports: [CategoryGuesser, Categorising],
})
export class CategoriesModule {}
