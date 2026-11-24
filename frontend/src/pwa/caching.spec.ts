import configJson from '../../ngsw-config.json';

interface AssetGroup {
  name: string;
  installMode: 'prefetch' | 'lazy';
  resources: { files?: string[]; urls?: string[] };
}

interface DataGroup {
  name: string;
  urls: string[];
  cacheConfig: {
    strategy: 'freshness' | 'performance';
    timeout?: string;
    maxAge: string;
    maxSize: number;
  };
}

interface ServiceWorkerConfig {
  index: string;
  navigationUrls?: string[];
  assetGroups: AssetGroup[];
  dataGroups: DataGroup[];
}

/** The glob dialect of ngsw-config.json: `**` spans path segments, `*` stays within one. */
function matches(glob: string, path: string, anchored = true): boolean {
  const pattern = glob
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<ANY>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<ANY>>/g, '.*');
  return new RegExp(anchored ? `^${pattern}$` : pattern).test(path);
}

describe('service worker caching', () => {
  const config = configJson as ServiceWorkerConfig;

  // The worker does not anchor the patterns of a data group, so a URL belongs to the first group
  // with a pattern that matches the start of it: `/api/overview` also takes `/api/overview/x`.
  const dataGroupFor = (url: string) =>
    config.dataGroups.find((group) => group.urls.some((glob) => matches(glob, url, false)));

  describe('app shell', () => {
    const shell = config.assetGroups.find((group) => group.installMode === 'prefetch');
    const files = shell?.resources.files ?? [];
    const isCached = (path: string) => files.some((glob) => matches(glob, path));

    it('is fetched up front so the app opens without a connection', () => {
      expect(shell).toBeDefined();
    });

    it.each([
      '/index.html',
      '/main-4DJ7QWXV.js',
      '/styles-5INURTSO.css',
      '/manifest.webmanifest',
      '/icons/icon-192.png',
      '/media/inter-latin-wght-normal-NRMW37G5.woff2',
      '/favicon.ico',
    ])('includes %s', (path) => {
      expect(isCached(path)).toBe(true);
    });
  });

  // The bank sends the browser to /api/connections/callback; the service worker must let that
  // navigation reach the backend instead of answering with the app shell.
  describe('navigation', () => {
    const navigationUrls = config.navigationUrls ?? ['/**'];
    const opensAppShell = (path: string) => {
      const included = navigationUrls.some((glob) => !glob.startsWith('!') && matches(glob, path));
      const excluded = navigationUrls.some(
        (glob) => glob.startsWith('!') && matches(glob.slice(1), path),
      );
      return included && !excluded;
    };

    it('opens the app shell for app routes', () => {
      expect(opensAppShell('/')).toBe(true);
      expect(opensAppShell('/transaktioner')).toBe(true);
    });

    it('lets the connection callback reach the backend', () => {
      expect(opensAppShell('/api/connections/callback')).toBe(false);
    });
  });

  describe('data', () => {
    // Every read the stores make, so any page the owner has opened works offline (ADR 0017).
    it.each([
      '/api/accounts',
      '/api/banks',
      '/api/categories',
      '/api/household-ratio',
      '/api/subcategory-shares',
      '/api/manual-savings-accounts',
      '/api/mortgage',
      '/api/mortgage/figures',
      '/api/overview?month=2026-11&view=mine',
      '/api/overview/transactions?month=2026-11&subcategoryId=3',
      '/api/savings',
      '/api/settlement',
      '/api/transactions',
      '/api/transactions?before=2026-11-01T10%3A00%3A00.000Z',
      // Angular leaves a slash in a query value as it is.
      '/api/transactions?q=a/b',
      '/api/transactions/review',
      '/api/transactions/review/count',
      '/api/transactions/9f3c2a1e',
      '/api/transactions/9f3c2a1e/offset-candidates?amount=-100',
    ])('serves %s from the network when it can and from the cache when it cannot', (url) => {
      const group = dataGroupFor(url);

      expect(group?.cacheConfig.strategy).toBe('freshness');
      // A timeout makes a weak connection fall back to the cache instead of hanging.
      expect(group?.cacheConfig.timeout).toBeDefined();
    });

    it('drops saved data that was fetched more than 30 days ago', () => {
      expect(config.dataGroups.length).toBeGreaterThan(0);
      for (const group of config.dataGroups) expect(group.cacheConfig.maxAge).toBe('30d');
    });

    it('keeps room for what the owner browses without pushing out the main pages', () => {
      const pages = dataGroupFor('/api/settlement');
      const browsed = dataGroupFor('/api/transactions/9f3c2a1e');

      expect(pages).not.toBe(browsed);
      expect(browsed?.cacheConfig.maxSize).toBeGreaterThanOrEqual(500);
      // Months and drill-downs the owner has been through are browsing too, not main pages.
      expect(dataGroupFor('/api/overview/transactions?month=2026-11&subcategoryId=3')).toBe(
        browsed,
      );
      expect(dataGroupFor('/api/transactions?q=ica')).toBe(browsed);
      expect(dataGroupFor('/api/overview?month=2026-11&view=mine')).toBe(pages);
    });

    it.each([
      '/api/connections',
      '/api/auth/me',
      '/api/auth/login',
      '/api/auth/logout',
      // The check that tells whether the server can be reached must never be answered from saved data.
      '/api/health',
      '/api/sync',
      '/api/connections/callback',
    ])('does not cache %s', (url) => {
      expect(dataGroupFor(url)).toBeUndefined();
    });
  });
});
