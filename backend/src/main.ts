import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app';

// Where the built frontend lives. In the Docker image this is set explicitly; locally it points at
// the Angular build output so `pnpm build && pnpm start` serves the whole app.
const staticDir =
  process.env['STATIC_DIR'] ?? resolve(__dirname, '../../frontend/dist/frontend/browser');
const port = Number(process.env['PORT'] ?? 3000);

async function bootstrap(): Promise<void> {
  const app = await createApp({ staticDir: existsSync(staticDir) ? staticDir : undefined });
  await app.listen(port);
  console.log(`bankapp listening on port ${port}`);
}

void bootstrap();
