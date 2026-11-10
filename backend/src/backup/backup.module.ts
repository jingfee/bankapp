import { Module } from '@nestjs/common';
import { BackupScheduler } from './backup.scheduler';

@Module({ providers: [BackupScheduler] })
export class BackupModule {}
