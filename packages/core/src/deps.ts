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
  fetch?: typeof fetch;
}

// Who is acting. Every service call is scoped to one organization (tenant).
export interface Actor {
  orgId: string;
  userId?: string;
}
