import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { SavingsModule } from '../savings/savings.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [SyncModule, SavingsModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService],
})
export class ConnectionsModule {}
