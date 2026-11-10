import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { API_PREFIX, AppModule, type AppOptions } from './app.module';

export async function createApp(options: AppOptions): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(options), { logger: ['error', 'warn'] });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
