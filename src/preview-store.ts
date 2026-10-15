/**
 * Holds dry-run previews between the two beats of a write.
 *
 * In-memory is correct for v1: stdio means one long-lived process per client,
 * and a preview that doesn't survive a restart is a feature — a stale preview
 * should never be committable. Previews are single-use and expire.
 */

const TTL_MS = 10 * 60 * 1000;

interface Entry<T> {
  payload: T;
  createdAt: number;
}

export class PreviewStore<T> {
  private entries = new Map<string, Entry<T>>();
  private counter = 0;

  put(payload: T): { previewId: string; expiresInMinutes: number } {
    this.sweep();
    // Short and human-readable — the operator reads this id back out loud.
    const previewId = `pv_${Date.now().toString(36)}${(this.counter++).toString(36)}`;
    this.entries.set(previewId, { payload, createdAt: Date.now() });
    return { previewId, expiresInMinutes: TTL_MS / 60000 };
  }

  /** Consumes the preview: a given previewId can only ever commit once. */
  take(previewId: string): { ok: true; payload: T } | { ok: false; reason: string } {
    this.sweep();
    const entry = this.entries.get(previewId);
    if (!entry) {
      return {
        ok: false,
        reason: `Preview ${previewId} is unknown, already used, or expired. Re-run with dryRun to get a fresh one.`,
      };
    }
    this.entries.delete(previewId);
    return { ok: true, payload: entry.payload };
  }

  /** Put a taken preview back — only for failures that provably wrote nothing. */
  restore(previewId: string, payload: T) {
    this.entries.set(previewId, { payload, createdAt: Date.now() });
  }

  private sweep() {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, entry] of this.entries) {
      if (entry.createdAt < cutoff) this.entries.delete(id);
    }
  }
}
