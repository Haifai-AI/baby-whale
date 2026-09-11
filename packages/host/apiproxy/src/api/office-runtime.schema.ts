/**
 * office-runtime domain zod schemas (names derived from map keys:
 * officeRuntimeStatusRequestSchema / officeRuntimeStatusValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** officeRuntime.status request payload (empty). */
export const officeRuntimeStatusRequestSchema = z.object({
}) satisfies z.ZodType<Wire<RequestPayload<'officeRuntime.status'>>>

/** officeRuntime.status response value. */
export const officeRuntimeStatusValueSchema = z.object({
  soffice: z.object({
    found: z.boolean(),
    source: z.enum(['managed', 'system', 'none']),
    path: z.string().min(1).optional(),
  }),
  install: z.object({
    phase: z.enum(['idle', 'downloading', 'installing', 'done', 'error']),
    progress: z.number(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  managedSupported: z.boolean(),
  guideUrl: z.url().optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'officeRuntime.status'>>>

/** officeRuntime.install request payload (empty). */
export const officeRuntimeInstallRequestSchema = z.object({
}) satisfies z.ZodType<Wire<RequestPayload<'officeRuntime.install'>>>

/** officeRuntime.install response value. */
export const officeRuntimeInstallValueSchema = z.object({
  install: officeRuntimeStatusValueSchema.shape.install,
}) satisfies z.ZodType<Wire<ResponseValue<'officeRuntime.install'>>>
