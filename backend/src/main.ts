import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config/config';
import { HttpEnableBankingClient } from './enable-banking/http-enable-banking-client';

// Where the built frontend lives. In the Docker image this is set explicitly; locally it points at
// the Angular build output so `pnpm build && pnpm start` serves the whole app.
const staticDir =
  process.env['STATIC_DIR'] ?? resolve(__dirname, '../../frontend/dist/frontend/browser');
const port = Number(process.env['PORT'] ?? 3000);

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await createApp({
    config,
    enableBanking: new HttpEnableBankingClient({
      applicationId: config.applicationId,
      privateKeyPem: readFileSync(config.privateKeyPath, 'utf8'),
    }),
    staticDir: existsSync(staticDir) ? staticDir : undefined,
  });
  await app.listen(port);
  console.log(`bankapp listening on port ${port}`);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
