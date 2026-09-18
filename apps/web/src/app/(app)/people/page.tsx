'use client';

import { PeopleDirectory } from '@/components/people/people-directory';

/** Everybody on staff. Vendor sign-ins have their own page (v2.68): /vendor-accounts. */
export default function PeoplePage() {
  return <PeopleDirectory audience="staff" />;
}
