import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app';
import { SESSION_COOKIE } from '../src/auth/session-cookie';
import { SESSION_DAYS } from '../src/auth/session.service';
import { FakeEnableBankingClient, TEST_PASSWORD, testConfig } from './support';

describe('login', () => {
  let app: INestApplication;
  let now: Date;

  beforeEach(async () => {
    now = new Date('2026-11-15T10:00:00Z');
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
      now: () => now,
    });
    await app.init();
  });

  afterEach(() => app.close());

  const server = () => app.getHttpServer();
  const login = (username = 'owner', password = TEST_PASSWORD) =>
    request(server()).post('/api/auth/login').send({ username, password });
  const setCookies = (response: request.Response): string[] => {
    const header: string | string[] | undefined = response.headers['set-cookie'];
    return header === undefined ? [] : [header].flat();
  };
  const sessionCookie = (response: request.Response): string => {
    const header = setCookies(response).find((cookie) => cookie.startsWith(SESSION_COOKIE));
    if (header === undefined) throw new Error('no session cookie was set');
    return header;
  };
  const cookieValue = (header: string) => header.split(';')[0];

  describe('guard', () => {
    it.each(['/api/banks', '/api/accounts', '/api/auth/me', '/api/connections/callback-x'])(
      'rejects %s without a session',
      async (path) => {
        const status = path.endsWith('-x') ? 404 : 401;
        await request(server()).get(path).expect(status);
      },
    );

    it('rejects writes without a session', async () => {
      await request(server()).post('/api/sync').expect(401);
    });

    it('leaves the health check open', async () => {
      await request(server()).get('/api/health').expect(200);
    });

    it('lets the Enable Banking callback through without a cookie', async () => {
      // Unknown state is a 400 page, not a 401: the guard let the request in.
      await request(server()).get('/api/connections/callback?state=nope').expect(400);
    });

    it('rejects a made-up session cookie', async () => {
      await request(server())
        .get('/api/banks')
        .set('Cookie', `${SESSION_COOKIE}=forged`)
        .expect(401);
    });
  });

  describe('logging in', () => {
    it('sets a long-lived HttpOnly, Secure, SameSite=Strict cookie for the right credentials', async () => {
      const response = await login().expect(204);

      const cookie = sessionCookie(response);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\//i);
      expect(cookie).toContain(`Max-Age=${SESSION_DAYS * 24 * 3600}`);
    });

    it('gives access to the API and to /me', async () => {
      const cookie = cookieValue(sessionCookie(await login()));

      await request(server()).get('/api/banks').set('Cookie', cookie).expect(200);
      const me = await request(server()).get('/api/auth/me').set('Cookie', cookie).expect(200);
      expect(me.body).toEqual({ username: 'owner' });
    });

    it.each([
      ['wrong password', 'owner', 'nope'],
      ['wrong username', 'someone', TEST_PASSWORD],
      ['empty password', 'owner', ''],
    ])('refuses %s and sets no cookie', async (_name, username, password) => {
      const response = await login(username, password).expect(401);

      expect(setCookies(response)).toEqual([]);
    });

    it('refuses a body that is not credentials', async () => {
      await request(server()).post('/api/auth/login').send({ username: 1 }).expect(401);
      await request(server()).post('/api/auth/login').expect(401);
    });

    it('stops accepting a session once it has expired', async () => {
      const cookie = cookieValue(sessionCookie(await login()));

      now = new Date(now.getTime() + (SESSION_DAYS * 24 * 3600 - 60) * 1000);
      await request(server()).get('/api/banks').set('Cookie', cookie).expect(200);
      now = new Date(now.getTime() + 120 * 1000);
      await request(server()).get('/api/banks').set('Cookie', cookie).expect(401);
    });
  });

  describe('logging out', () => {
    it('invalidates the session on the server and clears the cookie', async () => {
      const cookie = cookieValue(sessionCookie(await login()));

      const response = await request(server())
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .expect(204);

      expect(sessionCookie(response)).toMatch(/Expires=Thu, 01 Jan 1970/i);
      await request(server()).get('/api/banks').set('Cookie', cookie).expect(401);
    });

    it('clears a stale cookie even when the session is already gone', async () => {
      const response = await request(server())
        .post('/api/auth/logout')
        .set('Cookie', `${SESSION_COOKIE}=stale`)
        .expect(204);

      expect(sessionCookie(response)).toMatch(/Expires=Thu, 01 Jan 1970/i);
    });

    it('leaves other sessions alone', async () => {
      const first = cookieValue(sessionCookie(await login()));
      const second = cookieValue(sessionCookie(await login()));

      await request(server()).post('/api/auth/logout').set('Cookie', first).expect(204);

      await request(server()).get('/api/banks').set('Cookie', second).expect(200);
    });
  });

  describe('repeated failures', () => {
    it('answers 429 from the sixth wrong attempt, even with the right password', async () => {
      for (let attempt = 0; attempt < 5; attempt++) await login('owner', 'wrong').expect(401);

      const blocked = await login('owner', 'wrong').expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      const stillBlocked = await login().expect(429);
      expect(setCookies(stillBlocked)).toEqual([]);
    });

    it('lets the owner in again once the failures are 15 minutes old', async () => {
      for (let attempt = 0; attempt < 5; attempt++) await login('owner', 'wrong').expect(401);
      await login().expect(429);

      now = new Date(now.getTime() + 15 * 60 * 1000 + 1000);

      await login().expect(204);
    });

    it('counts attempts made at the same time, so a burst cannot beat the limit', async () => {
      const burst = await Promise.all(Array.from({ length: 12 }, () => login('owner', 'wrong')));

      expect(burst.filter((response) => response.status === 401)).toHaveLength(5);
      expect(burst.filter((response) => response.status === 429)).toHaveLength(7);
    });

    it('does not count successful logins', async () => {
      for (let attempt = 0; attempt < 8; attempt++) await login().expect(204);
    });
  });
});
