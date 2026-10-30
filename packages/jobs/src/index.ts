// BullMQ implementation of core's JobQueue, shared by apps/api (producer) and apps/worker (consumer
// and schedule reconciliation).
import type { JobQueue } from '@tricity/core';
import { autoblogSchedulerId, JOBS, QUEUES } from '@tricity/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

// BullMQ 6 needs a constructed client under ESM; workers require maxRetriesPerRequest: null.
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export interface BullJobQueue extends JobQueue {
  queues: { generation: Queue; autoblog: Queue };
  close(): Promise<void>;
}

const KEEP = { removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } };

export function createJobQueue(connection: Redis): BullJobQueue {
  const generation = new Queue(QUEUES.generation, { connection, defaultJobOptions: KEEP });
  const autoblog = new Queue(QUEUES.autoblog, { connection, defaultJobOptions: KEEP });

  return {
    queues: { generation, autoblog },
    async generate(job) {
      // Retries only happen for retryable AI errors (rate limits, overload); see runGeneration.
      await generation.add(JOBS.generate, job, { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } });
    },
    async publish(job) {
      await generation.add(JOBS.publish, job, { attempts: 1 });
    },
    async autoblogRun(job) {
      await autoblog.add(JOBS.autoblogRun, job, { attempts: 1 });
    },
    async scheduleAutoblog(job) {
      const id = autoblogSchedulerId(job.siteId);
      if (!job.enabled) {
        await autoblog.removeJobScheduler(id);
        return;
      }
      await autoblog.upsertJobScheduler(
        id,
        { pattern: job.schedule, tz: job.timezone },
        { name: JOBS.autoblogRun, data: { orgId: job.orgId, siteId: job.siteId, manual: false } },
      );
    },
    async close() {
      await Promise.all([generation.close(), autoblog.close()]);
    },
  };
}
