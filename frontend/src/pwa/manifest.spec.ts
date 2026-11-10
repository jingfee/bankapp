import manifestSource from '../../public/manifest.webmanifest?raw';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  lang: string;
  start_url: string;
  scope: string;
  display: string;
  icons: ManifestIcon[];
}

describe('web app manifest', () => {
  const manifest = JSON.parse(manifestSource) as Manifest;

  it('names the app Bankapp in Swedish', () => {
    expect(manifest.name).toBe('Bankapp');
    expect(manifest.short_name).toBe('Bankapp');
    expect(manifest.lang).toBe('sv');
  });

  it('opens as a standalone app from the root', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });

  // Android Chrome only offers installation with 192px and 512px PNG icons.
  it('has the icon sizes Android Chrome requires for installation', () => {
    const anyPurpose = manifest.icons.filter((icon) => (icon.purpose ?? 'any') === 'any');
    expect(anyPurpose.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512']);
    expect(manifest.icons.every((icon) => icon.type === 'image/png')).toBe(true);
  });

  it('has a maskable icon so Android can shape it', () => {
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });
});
