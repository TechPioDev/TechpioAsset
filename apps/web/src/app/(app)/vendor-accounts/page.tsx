'use client';

import { PeopleDirectory } from '@/components/people/people-directory';

/**
 * Vendor sign-ins (v2.68). The owner asked for them out of the People list and
 * under a menu of their own: they are not employees, hold no assets and belong
 * to a vendor company rather than a department.
 */
export default function VendorAccountsPage() {
  return <PeopleDirectory audience="vendors" />;
}
