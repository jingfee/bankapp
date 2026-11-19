import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { BackupModule } from './backup/backup.module';
import { BanksModule } from './banks/banks.module';
import { CategoriesModule } from './categories/categories.module';
import type { AppConfig } from './config/config';
import { CLOCK, clock } from './clock';
import { ConnectionsModule } from './connections/connections.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule, type DatabaseLocation } from './db/database.module';
import type { EnableBankingClient } from './enable-banking/enable-banking-client';
import { EnableBankingModule } from './enable-banking/enable-banking.module';
import { HealthController } from './health/health.controller';
import { ManualSavingsModule } from './manual-savings/manual-savings.module';
import { OverviewModule } from './overview/overview.module';
import { SavingsModule } from './savings/savings.module';
import { TransactionsModule } from './transactions/transactions.module';
import { DomainErrorFilter } from './domain-error.filter';
import { SettlementModule } from './settlement/settlement.module';

export const API_PREFIX = 'api';

export interface AppOptions {
  /** Validated configuration. */
  config: AppConfig;
  /** How the app talks to Enable Banking: the real HTTP client in production, a fake in tests. */
  enableBanking: EnableBankingClient;
  /** Where the database lives. Defaults to the configured data directory; tests use memory. */
  database?: DatabaseLocation;
  /** Directory holding the built frontend. When omitted, only the API is served (e.g. in development). */
  staticDir?: string;
  /** Current time; injectable for tests. */
  now?: () => Date;
}

@Global()
@Module({})
export class AppModule {
  static register(options: AppOptions): DynamicModule {
    const staticFrontendModules = options.staticDir
      ? [
          ServeStaticModule.forRoot({
            rootPath: options.staticDir,
            // Unknown /api routes must stay JSON 404s instead of falling back to the frontend.
            exclude: [`/${API_PREFIX}/{*path}`],
          }),
        ]
      : [];

    return {
      module: AppModule,
      providers: [
        {
          provide: CLOCK,
          useValue: clock(options.now ?? (() => new Date()), options.config.timezone),
        },
        { provide: APP_FILTER, useClass: DomainErrorFilter },
      ],
      exports: [CLOCK],
      imports: [
        ConfigModule.register(options.config),
        DatabaseModule.register(options.database ?? { dataDir: options.config.dataDir }),
        EnableBankingModule.register(options.enableBanking),
        ScheduleModule.forRoot(),
        AuthModule,
        BanksModule,
        CategoriesModule,
        ConnectionsModule,
        TransactionsModule,
        AccountsModule,
        OverviewModule,
        SettlementModule,
        ManualSavingsModule,
        SavingsModule,
        BackupModule,
        ...staticFrontendModules,
      ],
      controllers: [HealthController],
    };
  }
}
