// BullMQ queue names and job payloads shared by apps/api (producer) and apps/worker (consumer).
import { z } from 'zod';

export const QUEUES = {
  // Article generation and publishing to WordPress.
  generation: 'generation',
  // Auto-blogging runs, triggered by per-site job schedulers or manually.
  autoblog: 'autoblog',
} as const;

export const JOBS = {
  generate: 'generate',
  publish: 'publish',
  autoblogRun: 'autoblog-run',
} as const;

export const generateJobSchema = z.object({
  orgId: z.string(),
  generationId: z.string(),
});
export type GenerateJob = z.infer<typeof generateJobSchema>;

export const publishJobSchema = z.object({
  orgId: z.string(),
  generationId: z.string(),
  status: z.enum(['draft', 'publish', 'future']),
  scheduledAt: z.string().optional(),
});
export type PublishJob = z.infer<typeof publishJobSchema>;

export const autoblogRunJobSchema = z.object({
  orgId: z.string(),
  siteId: z.string(),
  // Manual runs happen even when the schedule is disabled.
  manual: z.boolean().default(false),
});
export type AutoblogRunJob = z.input<typeof autoblogRunJobSchema>;

export const autoblogScheduleJobSchema = z.object({
  orgId: z.string(),
  siteId: z.string(),
  enabled: z.boolean(),
  schedule: z.string(),
  timezone: z.string(),
});
export type AutoblogScheduleJob = z.infer<typeof autoblogScheduleJobSchema>;

// Job scheduler ids are derived from the site so re-saving a profile replaces its schedule.
export const autoblogSchedulerId = (siteId: string) => `autoblog:${siteId}`;
