import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { expandHome } from "../config/load.ts";

export interface LockInfo {
  pid: number;
  instanceId: string;
  objectName: string;
  acquiredAt: number;
}

export class ObjectLockManager {
  private instanceId: string;
  private locksDir: string;
  private heldLocks = new Set<string>();

  constructor(instanceId: string = crypto.randomUUID(), baseDir = "~/.pi/agent/gather-locks") {
    this.instanceId = instanceId;
    this.locksDir = expandHome(baseDir);
    try {
      fs.mkdirSync(this.locksDir, { recursive: true });
    } catch {
      // Best-effort
    }
  }

  private getLockPath(endpointUrl: string): string {
    const hash = crypto.createHash("sha256").update(endpointUrl).digest("hex").slice(0, 16);
    return path.join(this.locksDir, `gso-${hash}.lock`);
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  tryAcquire(objectName: string, endpointUrl: string): boolean {
    const lockPath = this.getLockPath(endpointUrl);
    const lockData: LockInfo = {
      pid: process.pid,
      instanceId: this.instanceId,
      objectName,
      acquiredAt: Date.now(),
    };

    try {
      // Atomic creation
      const fd = fs.openSync(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        0o600,
      );
      fs.writeSync(fd, JSON.stringify(lockData, null, 2));
      fs.closeSync(fd);
      this.heldLocks.add(endpointUrl);
      return true;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "EEXIST") {
        // Check if existing lock is orphan
        try {
          const content = fs.readFileSync(lockPath, "utf-8");
          const existing: LockInfo = JSON.parse(content);

          if (existing.instanceId === this.instanceId) {
            this.heldLocks.add(endpointUrl);
            return true;
          }

          if (!this.isProcessAlive(existing.pid)) {
            // Process dead - steal lock
            fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2), { mode: 0o600 });
            this.heldLocks.add(endpointUrl);
            return true;
          }

          // Lock held by active external process
          return false;
        } catch {
          // Corrupt lock file - re-acquire
          try {
            fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2), { mode: 0o600 });
            this.heldLocks.add(endpointUrl);
            return true;
          } catch {
            return false;
          }
        }
      }
      return false;
    }
  }

  release(endpointUrl: string): void {
    if (!this.heldLocks.has(endpointUrl)) return;
    const lockPath = this.getLockPath(endpointUrl);
    try {
      if (fs.existsSync(lockPath)) {
        const content = fs.readFileSync(lockPath, "utf-8");
        const existing: LockInfo = JSON.parse(content);
        if (existing.instanceId === this.instanceId) {
          fs.unlinkSync(lockPath);
        }
      }
    } catch {
      // Best-effort
    } finally {
      this.heldLocks.delete(endpointUrl);
    }
  }

  releaseAll(): void {
    for (const url of Array.from(this.heldLocks)) {
      this.release(url);
    }
  }

  isHeldByMe(endpointUrl: string): boolean {
    return this.heldLocks.has(endpointUrl);
  }

  getLockStatus(endpointUrl: string): { ownedByMe: boolean; ownerPid?: number; locked: boolean } {
    if (this.heldLocks.has(endpointUrl)) {
      return { ownedByMe: true, ownerPid: process.pid, locked: true };
    }
    const lockPath = this.getLockPath(endpointUrl);
    if (!fs.existsSync(lockPath)) {
      return { ownedByMe: false, locked: false };
    }
    try {
      const content = fs.readFileSync(lockPath, "utf-8");
      const existing: LockInfo = JSON.parse(content);
      const alive = this.isProcessAlive(existing.pid);
      if (!alive) {
        return { ownedByMe: false, locked: false };
      }
      return {
        ownedByMe: existing.instanceId === this.instanceId,
        ownerPid: existing.pid,
        locked: true,
      };
    } catch {
      return { ownedByMe: false, locked: false };
    }
  }
}
