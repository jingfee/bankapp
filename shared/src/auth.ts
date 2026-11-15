/** Body of `POST /api/auth/login`. */
export interface LoginRequest {
  username: string;
  password: string;
}

/** Response body of `GET /api/auth/me`, sent only to a signed-in owner. */
export interface MeResponse {
  username: string;
}
