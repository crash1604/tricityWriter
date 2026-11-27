'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { authClient } from '../lib/auth-client';

// Signed-in visitors skip the landing page and go straight to their sites.
export function HomeRedirect() {
  const router = useRouter();
  const session = authClient.useSession();
  useEffect(() => {
    if (session.data) router.replace('/sites');
  }, [session.data, router]);
  return null;
}
