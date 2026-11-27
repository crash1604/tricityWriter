import type { AiService } from '@tricity/ai';
import type { Db } from '@tricity/db';
import type { AutoblogRunJob, AutoblogScheduleJob, GenerateJob, PublishJob } from '@tricity/shared';

// Background work. apps/api implements this with BullMQ; tests use an in-memory fake.
export interface JobQueue {
  generate(job: GenerateJob): Promise<void>;
  publish(job: PublishJob): Promise<void>;
  autoblogRun(job: AutoblogRunJob): Promise<void>;
  // Creates, replaces or (when disabled) removes the repeating schedule for one site.
  scheduleAutoblog(job: AutoblogScheduleJob): Promise<void>;
}

export interface CoreDeps {
  db: Db;
  ai: AiService;
  encryptionKey: Buffer;
  jobs: JobQueue;
  // Sent to WordPress sites so hosts can identify (and allow-list) our traffic.
  userAgent: string;
  // Used for every call to a WordPress site; production passes one that refuses private addresses.
  fetch?: typeof fetch;
  // The dashboard's public address, given to the connector plugin at pairing for its update checks.
  platformUrl?: string;
  limits?: Limits;
}

export interface Limits {
  // What each workspace may spend per calendar month (UTC) through platform-held AI keys, in USD.
  // Unset = no cap. A workspace's own keys (BYOK) are never capped.
  platformMonthlyBudgetUsd?: number;
  // Articles a workspace may have queued or generating at once, so one workspace can't starve the
  // shared worker. Unset = no cap.
  maxActiveGenerations?: number;
}

// Who is acting. Every service call is scoped to one organization (tenant).
export interface Actor {
  orgId: string;
  userId?: string;
  // Role in the workspace; absent for system work (worker jobs).
  role?: 'owner' | 'admin' | 'member';
}
