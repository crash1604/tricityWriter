import { forOrg, system } from '@tricity/db';
import type { CoreDeps } from './deps';
import { siteClient } from './sites';

// Everything a workspace owns goes when the workspace does: schedules stop, every connected WordPress
// site revokes our token (best effort; the site may be gone), and all tenant rows are deleted.
// Runs inside the delete request, so sites are handled in parallel and an offline one is given up on.
const DISCONNECT_TIMEOUT_MS = 5_000;

export async function deleteWorkspaceData(deps: CoreDeps, orgId: string): Promise<void> {
  const scope = forOrg(deps.db, orgId);
  await Promise.allSettled(
    (await scope.sites.list()).map(async (site) => {
      await deps.jobs.scheduleAutoblog({ orgId, siteId: site.id, enabled: false, schedule: '', timezone: 'UTC' });
      if (site.tokenCiphertext) {
        await Promise.race([
          siteClient(deps, site).disconnect(),
          new Promise((resolve) => setTimeout(resolve, DISCONNECT_TIMEOUT_MS).unref()),
        ]);
      }
    }),
  );
  await scope.deleteAll();
}

// What a deleted account leaves behind outside its own workspaces.
export async function forgetUser(deps: CoreDeps, userId: string): Promise<void> {
  await system.revokeMcpKeysOfUser(deps.db, userId);
}
