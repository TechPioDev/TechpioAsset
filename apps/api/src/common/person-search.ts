import type { Prisma } from '@prisma/client';

/**
 * A person, by what somebody typing into a search box knows about them
 * (Phase 3, v2.79): "ravi", "Ravi Menon", "menon", "ravi@techpio.com", or an
 * employee number.
 *
 * Every word must match the first name, last name, email or employee number,
 * so "Ravi Menon" finds Ravi Menon and not every Ravi. Four words at most -
 * enough for any name, and a pasted paragraph does not become forty joins.
 *
 * Used inside a list's own search, which is itself ANDed with the caller's
 * scope, so matching a name never shows anything the caller could not
 * already see.
 */
export function personMatches(term: string): Prisma.UserWhereInput | null {
  const words = term.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) return null;
  return {
    AND: words.map((word) => ({
      OR: [
        { email: { contains: word, mode: 'insensitive' as const } },
        { profile: { is: { firstName: { contains: word, mode: 'insensitive' as const } } } },
        { profile: { is: { lastName: { contains: word, mode: 'insensitive' as const } } } },
        { profile: { is: { employeeNumber: { contains: word, mode: 'insensitive' as const } } } },
      ],
    })),
  };
}
