import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { SyncController } from './sync.controller';
import { SyncScheduler } from './sync.scheduler';
import { SyncService } from './sync.service';

@Module({
  imports: [CategoriesModule],
  controllers: [SyncController],
  providers: [SyncService, SyncScheduler],
  exports: [SyncService],
})
export class SyncModule {}
