import configJson from '../../ngsw-config.json';

interface AssetGroup {
  name: string;
  installMode: 'prefetch' | 'lazy';
  resources: { files?: string[]; urls?: string[] };
}

interface DataGroup {
  name: string;
  urls: string[];
  cacheConfig: { strategy: 'freshness' | 'performance'; timeout?: string; maxAge: string };
}

interface ServiceWorkerConfig {
  index: string;
  navigationUrls?: string[];
  assetGroups: AssetGroup[];
  dataGroups: DataGroup[];
}

/** The glob dialect of ngsw-config.json: `**` spans path segments, `*` stays within one. */
function matches(glob: string, path: string): boolean {
  const pattern = glob
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<ANY>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<ANY>>/g, '.*');
  return new RegExp(`^${pattern}$`).test(path);
}

describe('service worker caching', () => {
  const config = configJson as ServiceWorkerConfig;

  const dataGroupFor = (url: string) =>
    config.dataGroups.find((group) => group.urls.some((glob) => matches(glob, url)));

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
    it.each([
      '/api/accounts',
      '/api/transactions',
      '/api/transactions?before=2026-11-01T10%3A00%3A00.000Z',
    ])('serves %s from the network when it can and from the cache when it cannot', (url) => {
      const group = dataGroupFor(url);

      expect(group?.cacheConfig.strategy).toBe('freshness');
      // A timeout makes a weak connection fall back to the cache instead of hanging.
      expect(group?.cacheConfig.timeout).toBeDefined();
    });

    it.each([
      '/api/connections',
      '/api/banks',
      '/api/health',
      '/api/sync',
      '/api/connections/callback',
    ])('does not cache %s', (url) => {
      expect(dataGroupFor(url)).toBeUndefined();
    });
  });
});
