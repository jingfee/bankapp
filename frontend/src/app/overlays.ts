/** The overlays that are open, last one on top. Only the top one reacts to Escape. */
const open: symbol[] = [];

/** Registers an overlay as open; returns a function that reports whether it is on top, and a release. */
export function registerOverlay(): { isTop: () => boolean; release: () => void } {
  const id = Symbol('overlay');
  open.push(id);
  return {
    isTop: () => open.at(-1) === id,
    release: () => {
      const at = open.indexOf(id);
      if (at !== -1) open.splice(at, 1);
    },
  };
}
