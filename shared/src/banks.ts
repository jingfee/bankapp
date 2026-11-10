/** A bank the owner can connect, as listed by `GET /api/banks`. */
export interface Bank {
  name: string;
  logoUrl: string | null;
  /** Enable Banking marks banks whose integration is still in beta. */
  beta: boolean;
}

/** Response body of `GET /api/banks`, sorted by name. */
export interface BanksResponse {
  banks: Bank[];
}
