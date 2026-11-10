import { Global, Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { openDatabase } from './database';

export const DATABASE = Symbol('DATABASE');
const DATABASE_CLOSE = Symbol('DATABASE_CLOSE');

export type DatabaseLocation = Parameters<typeof openDatabase>[0];

@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CLOSE) private readonly close: () => void) {}

  static register(location: DatabaseLocation) {
    const { db, close } = openDatabase(location);
    return {
      module: DatabaseModule,
      providers: [
        { provide: DATABASE, useValue: db },
        { provide: DATABASE_CLOSE, useValue: close },
      ],
      exports: [DATABASE],
    };
  }

  onApplicationShutdown(): void {
    this.close();
  }
}
