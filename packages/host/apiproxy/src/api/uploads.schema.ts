/**
 * uploads domain zod schemas. Like the downloads family, this is a no-envelope
 * host channel, so only the URL query rides the wire; the body itself is raw
 * bytes with `application/octet-stream`.
 */

import { z } from 'zod'
import { sessionIdSchema } from './sessions.schema.ts'

/** workspace.upload query parameters. */
export const workspaceUploadQuerySchema = z.object({
  /** Session whose workspace receives the file. */
  session: sessionIdSchema,
  /** Proposed display name; the server sanitizes and de-conflicts it. */
  filename: z.string().min(1).max(200),
}) satisfies z.ZodType<{ session: string; filename: string }>
