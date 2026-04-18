import { z } from 'zod'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

// ProseMirror / TipTap document. Typed as generic JSON at the shared-schema
// layer; ProseMirror-validity is enforced by the editor, not the wire contract.
export type ProseMirrorDoc = JsonValue
export const ProseMirrorDocSchema: z.ZodType<ProseMirrorDoc> = JsonValueSchema
