type Bucket = {
  count: number;
  resetAt: number;
};

export class InMemoryRateLimiter {
  private buckets = new Map<string, Bucket>();

  public hit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }
}
