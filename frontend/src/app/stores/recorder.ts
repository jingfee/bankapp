import { type Observable, of } from 'rxjs';

/**
 * Used by the fake stores: records which mutations were called, and answers each with what the
 * test put in `responses` under the method's name (undefined when nothing was put there).
 */
export class Recorder {
  readonly calls: { method: string; args: unknown[] }[] = [];
  readonly responses: Record<string, unknown> = {};

  reply<T>(method: string, ...args: unknown[]): Observable<T> {
    this.calls.push({ method, args });
    return of(this.responses[method] as T);
  }
}
