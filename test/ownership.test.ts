import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ObjectLockManager } from "../src/runtime/ownership.ts";

describe("ObjectLockManager", () => {
  it("acquires and releases locks atomically", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gather-lock-test-"));
    try {
      const lockMgr1 = new ObjectLockManager("instance-1", tmpDir);
      const url = "https://api.v2.gather.town/test-endpoint";

      // Acquire lock with instance 1
      const acquired1 = lockMgr1.tryAcquire("testObj", url);
      expect(acquired1).toBe(true);
      expect(lockMgr1.isHeldByMe(url)).toBe(true);

      const status1 = lockMgr1.getLockStatus(url);
      expect(status1.locked).toBe(true);
      expect(status1.ownedByMe).toBe(true);
      expect(status1.ownerPid).toBe(process.pid);

      // Re-acquiring with same instance succeeds (re-entrant for same instance)
      expect(lockMgr1.tryAcquire("testObj", url)).toBe(true);

      // Second instance should fail because instance-1 holds it and is alive
      const lockMgr2 = new ObjectLockManager("instance-2", tmpDir);
      const acquired2 = lockMgr2.tryAcquire("testObj", url);
      expect(acquired2).toBe(false);

      const status2 = lockMgr2.getLockStatus(url);
      expect(status2.locked).toBe(true);
      expect(status2.ownedByMe).toBe(false);

      // Release lock with instance 1
      lockMgr1.release(url);
      expect(lockMgr1.isHeldByMe(url)).toBe(false);

      // Now instance 2 can acquire it
      const acquired2After = lockMgr2.tryAcquire("testObj", url);
      expect(acquired2After).toBe(true);
      expect(lockMgr2.isHeldByMe(url)).toBe(true);

      lockMgr2.release(url);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("steals orphan lock if holding process is dead", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gather-lock-test-"));
    try {
      const lockMgr = new ObjectLockManager("instance-test", tmpDir);
      const url = "https://api.v2.gather.town/orphan-test";

      // Manually write lock with dead PID (99999999)
      const crypto = require("node:crypto");
      const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
      const lockFile = path.join(tmpDir, `gso-${hash}.lock`);

      fs.writeFileSync(
        lockFile,
        JSON.stringify({
          pid: 99999999, // Unlikely to exist
          instanceId: "dead-instance",
          objectName: "testObj",
          acquiredAt: Date.now() - 10000,
        }),
      );

      // Check status reports unlocked / dead
      const status = lockMgr.getLockStatus(url);
      expect(status.locked).toBe(false);

      // Acquiring should succeed and overwrite orphan lock
      const acquired = lockMgr.tryAcquire("testObj", url);
      expect(acquired).toBe(true);
      expect(lockMgr.isHeldByMe(url)).toBe(true);

      lockMgr.release(url);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
