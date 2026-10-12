import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

// One disk writer per state file. Coalesce same-turn saves; acknowledge only after staged file + directory sync.
export function snapshotWriter(file, getState) {
  let pending;
  let flushing = false;
  async function flush() {
    if (flushing || !pending) return;
    flushing = true;
    const batch = pending;
    pending = undefined;
    let tmp;
    try {
      const snapshot = JSON.stringify(getState());
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      // Unique exclusive temp files avoid stale/colliding .tmp files and protect telemetry before commit.
      tmp = `${file}.${randomUUID()}.tmp`;
      // Flush the staged bytes before an atomic replacement. The directory sync then
      // makes the rename durable across a host crash on supported local filesystems.
      const staged = await open(tmp, 'wx', 0o600);
      try { await staged.writeFile(snapshot, 'utf8'); await staged.sync(); }
      finally { await staged.close(); }
      await rename(tmp, file);
      tmp = undefined;
      const directory = await open(dirname(file), 'r');
      try { await directory.sync(); }
      finally { await directory.close(); }
      batch.resolve();
    } catch (error) {
      if (tmp) {
        try { await unlink(tmp); } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') console.error('DRM snapshot temporary-file cleanup failed:', cleanupError);
        }
      }
      batch.reject(error);
    } finally {
      flushing = false;
      if (pending) queueMicrotask(flush);
    }
  }
  return function persist() {
    if (!pending) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      pending = { promise, resolve, reject };
      queueMicrotask(flush);
    }
    return pending.promise;
  };
}
