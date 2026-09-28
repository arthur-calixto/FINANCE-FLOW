import { z } from 'zod';
import type { HealthResponse } from '@finance-flow/types';

export const healthResponseSchema: z.ZodType<HealthResponse> = z.object({
  status: z.literal('ok'),
});

export { z } from 'zod';
export const uuidSchema = z.uuid();
export const loginSchema = z.object({
  email: z.email().trim(),
  password: z.string().min(1, 'Informe a senha'),
});
export const passwordSchema = z
  .object({
    password: z.string().min(8, 'Use pelo menos 8 caracteres'),
    confirmation: z.string(),
  })
  .refine((v) => v.password === v.confirmation, {
    message: 'As senhas não coincidem',
    path: ['confirmation'],
  });
export const registerSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome').max(120),
    email: z.email().trim(),
    password: z.string().min(8, 'Use pelo menos 8 caracteres'),
    confirmation: z.string(),
  })
  .refine((v) => v.password === v.confirmation, {
    message: 'As senhas não coincidem',
    path: ['confirmation'],
  });
export const workspaceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  type: z.enum(['PERSONAL', 'FAMILY', 'BUSINESS']),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
});
export const meSchema = z.object({
  user: z.object({ id: uuidSchema, name: z.string(), email: z.email() }),
  workspaces: z.array(workspaceSchema),
});
