import { z } from "zod";

export const unitPricesSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
});

export const billingSchema = z.object({
  type: z.enum(["free", "pay-as-you-go", "subscription", "token-plan", "local"]),
  unitPrices: unitPricesSchema.optional(),
  currency: z.string().min(1).optional(),
});

export const capabilitiesSchema = z.object({
  contextWindow: z.number().int().positive(),
  maxOutput: z.number().int().positive().optional(),
  toolCalling: z.boolean().optional(),
  streaming: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  modalities: z.array(z.string()).optional(),
});

export const modelCreateSchema = z.object({
  name: z.string().min(1).max(200),
  provider: z.string().min(1).max(200),
  modelId: z.string().min(1).max(200),
  channel: z.enum(["direct", "runtime"]).default("direct"),
  wireApi: z.enum(["openai-compatible", "anthropic", "responses"]),
  baseUrl: z.string().max(500).optional(),
  authRef: z.string().max(200).optional(),
  billing: billingSchema,
  capabilities: capabilitiesSchema,
  status: z.enum(["active", "disabled", "error"]).optional(),
  addedBy: z.string().max(100).optional(),
});

export const modelUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  baseUrl: z.string().max(500).optional(),
  authRef: z.string().max(200).optional(),
  billing: billingSchema.optional(),
  capabilities: capabilitiesSchema.optional(),
  status: z.enum(["active", "disabled", "error"]).optional(),
});
