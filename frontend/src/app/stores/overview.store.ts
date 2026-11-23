import { Injectable, forwardRef } from '@angular/core';

/**
 * The overview only reads, so it has no mutations yet; its reads move in here with its page's
 * slice, and `Invalidation` already refreshes it for `transactions`, `accounts`, `shares`,
 * `settlement` and `banks`.
 */
@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpOverviewStore) })
export abstract class OverviewStore {}

@Injectable()
export class HttpOverviewStore extends OverviewStore {}
