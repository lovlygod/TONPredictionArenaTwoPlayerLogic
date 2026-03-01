export class WsError extends Error {
  constructor(
    public readonly code:
      | "BETA_REQUIRED"
      | "BETA_CODE_INVALID"
      | "BETA_CODE_USED"
      | "ALREADY_APPROVED"
      | "INSUFFICIENT_FUNDS"
      | "ROOM_NOT_FOUND"
      | "ROOM_CLOSED"
      | "STAKE_TOO_LOW"
      | "ALREADY_IN_MATCH"
      | "VOTE_CLOSED"
      | "NOT_ALIVE"
      | "RATE_LIMIT"
      | "BAD_REQUEST"
      | "UNAUTHORIZED",
    message: string,
  ) {
    super(message);
  }
}
