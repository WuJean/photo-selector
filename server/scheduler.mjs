// Shared per-service semaphore. Sleeping retries release their slot.
export class Scheduler {
  constructor() {
    this.services = new Map();
  }
  state(key, limit = 8) {
    if (!this.services.has(key))
      this.services.set(key, {
        active: 0,
        waiting: [],
        limit,
        ceiling: limit,
        successes: 0,
        until: 0,
      });
    const s = this.services.get(key);
    s.ceiling = limit;
    s.limit = Math.min(s.limit, limit);
    return s;
  }
  pump(s) {
    if (s.until > Date.now()) {
      clearTimeout(s.timer);
      s.timer = setTimeout(() => this.pump(s), s.until - Date.now());
      return;
    }
    while (s.active < s.limit && s.waiting.length) {
      const task = s.waiting.shift();
      task.cleanup();
      if (task.signal?.aborted) {
        task.reject(new Error("任务已取消"));
        continue;
      }
      s.active++;
      task.resolve(() => {
        s.active--;
        this.pump(s);
      });
    }
  }
  async run(key, limit, signal, fn) {
    const s = this.state(key, limit);
    const release = await new Promise((resolve, reject) => {
      const abort = () => {
        const i = s.waiting.indexOf(task);
        if (i >= 0) {
          s.waiting.splice(i, 1);
          task.cleanup();
          reject(new Error("任务已取消"));
        }
      };
      const task = {
        resolve,
        reject,
        signal,
        cleanup: () => signal?.removeEventListener("abort", abort),
      };
      s.waiting.push(task);
      signal?.addEventListener("abort", abort, { once: true });
      this.pump(s);
    });
    try {
      if (signal?.aborted) throw new Error("任务已取消");
      return await fn();
    } finally {
      release();
    }
  }
  limited(key, delay) {
    const s = this.services.get(key);
    if (s) {
      s.limit = Math.max(1, Math.floor(s.limit / 2));
      s.successes = 0;
      s.until = Date.now() + delay;
    }
  }
  success(key) {
    const s = this.services.get(key);
    if (s && ++s.successes >= 16) {
      s.successes = 0;
      s.limit = Math.min(s.ceiling, s.limit + 1);
    }
  }
}
export const scheduler = new Scheduler();
export const concurrency = (value, fallback) =>
  Math.max(1, Math.min(16, Math.trunc(Number(value) || fallback)));
export async function workers(count, next, work) {
  const results = await Promise.allSettled(
    Array.from({ length: count }, async () => {
      for (;;) {
        const item = next();
        if (item == null) return;
        await work(item);
      }
    }),
  );
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
}
