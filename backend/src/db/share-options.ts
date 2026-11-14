import type { ShareOption } from '@bankapp/shared';

/**
 * The share options (ADR 0007), in the order the UI lists them. A copy of `SHARE_OPTIONS` in
 * `@bankapp/shared`: the runtime image does not contain the shared package, so backend code
 * imports only types from it. The checks below fail to compile if the two drift apart.
 */
export const SHARE_OPTIONS = [
  'me',
  'half',
  'household',
  'partner',
] as const satisfies readonly ShareOption[];

const everyOptionListed: ShareOption extends (typeof SHARE_OPTIONS)[number] ? true : never = true;
void everyOptionListed;
