interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class IpRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly refillPerMs: number;
  private lastSweep = Date.now();

  constructor(
    private readonly capacity: number,
    perMinute: number
  ) {
    this.refillPerMs = perMinute / 60_000;
  }

  allow(ip: string): boolean {
    const now = Date.now();
    if (now - this.lastSweep > 60_000) {
      this.sweep(now);
    }

    let bucket = this.buckets.get(ip);
    if (!bucket) {
      bucket = { tokens: this.capacity, updatedAt: now };
      this.buckets.set(ip, bucket);
    } else {
      const elapsed = now - bucket.updatedAt;
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
      bucket.updatedAt = now;
    }

    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  }

  size() {
    return this.buckets.size;
  }

  private sweep(now: number) {
    this.lastSweep = now;
    const cutoff = now - 5 * 60_000;
    for (const [ip, bucket] of this.buckets) {
      if (bucket.updatedAt < cutoff && bucket.tokens >= this.capacity) {
        this.buckets.delete(ip);
      }
    }
  }
}
