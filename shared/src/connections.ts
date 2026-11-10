/** Request body of `POST /api/connections`. */
export interface StartConnectionRequest {
  /** Name of the bank to connect, as listed by `GET /api/banks`. */
  bank: string;
}

/** Response body of `POST /api/connections`: where to send the owner to log in with BankID. */
export interface StartConnectionResponse {
  url: string;
}
