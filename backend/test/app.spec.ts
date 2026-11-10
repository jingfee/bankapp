import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { HealthResponse } from '@bankapp/shared';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig } from './support';

const baseOptions = {
  config: testConfig,
  enableBanking: new FakeEnableBankingClient(),
  database: { inMemory: true as const },
};

describe('backend HTTP API', () => {
  let app: INestApplication;
  let staticDir: string;

  beforeEach(async () => {
    staticDir = mkdtempSync(join(tmpdir(), 'bankapp-static-'));
    writeFileSync(join(staticDir, 'index.html'), '<html><body>bankapp</body></html>');
    app = await createApp({ ...baseOptions, staticDir });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    rmSync(staticDir, { recursive: true, force: true });
  });

  it('reports health under /api', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    const body: HealthResponse = response.body;
    expect(body).toEqual({ status: 'ok' });
  });

  it('answers unknown API routes with a JSON 404, not the frontend', async () => {
    const response = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);

    expect(response.headers['content-type']).toMatch(/application\/json/);
  });

  it('serves the frontend for client-side routes', async () => {
    const response = await request(app.getHttpServer()).get('/konton/123').expect(200);

    expect(response.text).toContain('bankapp');
  });
});

describe('backend HTTP API without a built frontend', () => {
  it('still serves the API', async () => {
    const app = await createApp(baseOptions);
    await app.init();

    await request(app.getHttpServer()).get('/api/health').expect(200);

    await app.close();
  });
});
