import { z } from 'zod';

/**
 * An update schema derived from a create schema (v3.25).
 *
 * Zod 4 changed what `.partial()` means for a field with `.default()`: the
 * key becomes optional on the way in, but a missing key still comes out as the
 * default. For a create that is right. For a PATCH it is not: a request that
 * says only `{ condition: 'GOOD' }` arrived at the service as
 * `{ condition: 'GOOD', status: 'AVAILABLE', trackingType: 'INDIVIDUAL' }`,
 * which put a machine somebody had reported broken back in the pool and sent
 * a supplier's live offer back for review when only its stock figure moved.
 *
 * This keeps `.partial()` for the shape and strictness, then overrides every
 * defaulted field with its bare, optional inner type, so an update carries
 * exactly what the caller sent and nothing else.
 */
type WithoutDefault<T> = T extends z.ZodDefault<infer Inner> ? Inner : T;
type PartialShape<S extends z.ZodRawShape> = {
  [K in keyof S]: z.ZodOptional<WithoutDefault<S[K]>>;
};

export function partialUpdate<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  const stripped = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => {
      // The shape's entries are typed as Zod's core type; the classes are the public ones.
      const typed = field as z.ZodType;
      const inner = typed instanceof z.ZodDefault ? (typed.removeDefault() as z.ZodType) : typed;
      return [key, inner.optional()];
    }),
  ) as unknown as PartialShape<S>;
  return schema.partial().extend(stripped);
}
