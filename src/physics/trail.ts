/**
 * Fixed-capacity ring buffer of past positions (x, y, z), so trail rendering
 * never allocates and never degrades as the sim runs for hours.
 */
export class Trail {
  private buf: Float64Array;
  private head = 0;
  private count = 0;
  private cap: number;

  constructor(cap: number) {
    this.cap = cap;
    this.buf = new Float64Array(cap * 3);
  }

  get length(): number {
    return this.count;
  }

  get capacity(): number {
    return this.cap;
  }

  push(x: number, y: number, z: number): void {
    const i = this.head * 3;
    this.buf[i] = x;
    this.buf[i + 1] = y;
    this.buf[i + 2] = z;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  /** Iterate oldest → newest. `age` runs 0 (oldest) → 1 (newest). */
  forEach(fn: (x: number, y: number, z: number, age: number) => void): void {
    const start = (this.head - this.count + this.cap) % this.cap;
    const last = this.count - 1;
    for (let i = 0; i < this.count; i++) {
      const j = ((start + i) % this.cap) * 3;
      fn(this.buf[j], this.buf[j + 1], this.buf[j + 2], last === 0 ? 1 : i / last);
    }
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  setCapacity(cap: number): void {
    if (cap === this.cap) return;
    this.cap = cap;
    this.buf = new Float64Array(cap * 3);
    this.clear();
  }
}
