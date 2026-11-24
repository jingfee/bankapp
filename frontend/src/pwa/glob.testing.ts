/**
 * The glob dialect of ngsw-config.json: `**` spans path segments, `*` stays within one. The worker
 * anchors the patterns of asset groups but not those of data groups; `anchored: false` is that.
 */
export function matches(glob: string, path: string, anchored = true): boolean {
  const pattern = glob
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<ANY>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<ANY>>/g, '.*');
  return new RegExp(anchored ? `^${pattern}$` : pattern).test(path);
}
