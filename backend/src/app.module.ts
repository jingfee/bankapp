import { type DynamicModule, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { BanksModule } from './banks/banks.module';
import type { AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { DatabaseModule, type DatabaseLocation } from './db/database.module';
import type { EnableBankingClient } from './enable-banking/enable-banking-client';
import { EnableBankingModule } from './enable-banking/enable-banking.module';
import { HealthController } from './health/health.controller';

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
}

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
      imports: [
        ConfigModule.register(options.config),
        DatabaseModule.register(options.database ?? { dataDir: options.config.dataDir }),
        EnableBankingModule.register(options.enableBanking),
        ScheduleModule.forRoot(),
        BanksModule,
        ...staticFrontendModules,
      ],
      controllers: [HealthController],
    };
  }
}
