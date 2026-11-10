import { Global, Module } from '@nestjs/common';
import { EnableBankingClient } from './enable-banking-client';

@Global()
@Module({})
export class EnableBankingModule {
  static register(client: EnableBankingClient) {
    return {
      module: EnableBankingModule,
      providers: [{ provide: EnableBankingClient, useValue: client }],
      exports: [EnableBankingClient],
    };
  }
}
