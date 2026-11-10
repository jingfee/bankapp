import type { ConnectionStatus } from '@bankapp/shared';

/** A connection is warned about this long before it expires. */
export const EXPIRING_WITHIN_MS = 14 * 24 * 3600 * 1000;

export function connectionStatus(validUntil: Date, now: Date): ConnectionStatus {
  const remaining = validUntil.getTime() - now.getTime();
  if (remaining <= 0) return 'expired';
  return remaining <= EXPIRING_WITHIN_MS ? 'expiring' : 'active';
}
