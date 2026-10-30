// Test helpers shared by packages/core and apps/api tests. Not for production code.
import { AiService } from '@tricity/ai';
import type { CoreDeps, JobQueue } from '../deps';
import { fakeArticle } from '../generation/fake';

export { type FakeWordPress, fakeWordPress } from './fake-wordpress';

// Records jobs instead of queueing them; tests run them explicitly.
export function recordingJobs() {
  const calls: { kind: keyof JobQueue; job: unknown }[] = [];
  const jobs: JobQueue = {
    generate: async (job) => void calls.push({ kind: 'generate', job }),
    publish: async (job) => void calls.push({ kind: 'publish', job }),
    autoblogRun: async (job) => void calls.push({ kind: 'autoblogRun', job }),
    scheduleAutoblog: async (job) => void calls.push({ kind: 'scheduleAutoblog', job }),
  };
  return { jobs, calls };
}

export function fakeAi(): AiService {
  return new AiService({ platformKeys: {}, fake: fakeArticle });
}

export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7);

export function testDeps(overrides: Partial<CoreDeps> & Pick<CoreDeps, 'db'>): CoreDeps {
  return {
    ai: fakeAi(),
    encryptionKey: TEST_ENCRYPTION_KEY,
    jobs: recordingJobs().jobs,
    userAgent: 'TriCityWriter-test',
    ...overrides,
  };
}
