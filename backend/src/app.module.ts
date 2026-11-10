import { type DynamicModule, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { HealthController } from './health/health.controller';

export const API_PREFIX = 'api';

export interface AppOptions {
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
      imports: staticFrontendModules,
      controllers: [HealthController],
    };
  }
}
