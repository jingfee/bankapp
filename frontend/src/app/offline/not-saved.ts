import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Callout } from '../callout/callout';
import { Empty } from '../empty/empty';
import { Offline } from './offline.service';

/**
 * What is shown, offline, for a read that was never saved (ADR 0017): an older month, a filter
 * never used, a transaction never opened. It is not an error and not an empty result, so it
 * says neither.
 */
@Component({
  selector: 'app-not-saved',
  imports: [Empty],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-empty
    data-not-saved
    icon="inbox"
    text="Inte sparad"
    hint="Det här hämtas först när du är online igen."
  />`,
})
export class NotSaved {}

/**
 * A read that could not be fetched. Offline it was never saved, so it says _Inte sparad_;
 * online it is the page's own error, given as the content.
 */
@Component({
  selector: 'app-read-failed',
  imports: [Callout, NotSaved],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (offline.isOffline()) {
      <app-not-saved />
    } @else {
      <app-callout variant="danger"><ng-content /></app-callout>
    }
  `,
})
export class ReadFailed {
  protected readonly offline = inject(Offline);
}
