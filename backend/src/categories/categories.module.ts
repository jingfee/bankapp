import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CategoryGuesser } from './guessing/category-guesser';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, CategoryGuesser],
  exports: [CategoryGuesser],
})
export class CategoriesModule {}
