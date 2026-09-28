import { z } from 'zod';
import type { HealthResponse } from '@finance-flow/types';

export const healthResponseSchema: z.ZodType<HealthResponse> = z.object({
  status: z.literal('ok'),
});
