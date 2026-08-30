/**
 * artifacts domain zod schemas (names derived from map keys:
 * artifactsListRequestSchema / artifactsListValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/** artifacts.list request payload. */
export const artifactsListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'artifacts.list'>>>

/** artifacts.list response value. */
export const artifactsListValueSchema = z.object({
  artifacts: z.array(z.object({
    path: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['xlsx', 'docx', 'pptx', 'csv', 'pdf', 'image', 'text', 'other']),
    size: z.number(),
    modifiedAt: z.number(),
    origin: z.enum(['deliverable', 'upload']),
  })),
}) satisfies z.ZodType<Wire<ResponseValue<'artifacts.list'>>>

/** artifacts.preview request payload. */
export const artifactsPreviewRequestSchema = z.object({
  sessionId: sessionIdSchema,
  path: z.string().min(1).max(500),
}) satisfies z.ZodType<Wire<RequestPayload<'artifacts.preview'>>>

/** artifacts.preview response value (preview absent when the kind is unsupported/unreadable). */
export const artifactsPreviewValueSchema = z.object({
  preview: z.unknown().optional(),
  size: z.number(),
})

/** artifacts.file GET query parameters. */
export const artifactsFileQuerySchema = z.object({
  path: z.string().min(1),
})

/** artifacts.raw GET query parameters. */
export const artifactsRawQuerySchema = z.object({
  session: sessionIdSchema,
  path: z.string().min(1).max(500),
  /** Serve as an attachment download instead of inline. */
  download: z.enum(['1']).optional(),
})
