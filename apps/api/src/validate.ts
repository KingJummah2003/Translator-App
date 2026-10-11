import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError } from './errors';

/** Parses and validates a JSON body, turning any problem into a 400 the client can show. */
export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'bad_request', 'Expected a JSON body.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new ApiError(400, 'bad_request', `${where}${issue?.message ?? 'Invalid request'}`);
  }
  return parsed.data;
}
