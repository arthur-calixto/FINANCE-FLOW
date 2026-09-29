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

const resourceName = z
  .string()
  .trim()
  .min(1, 'Informe um nome')
  .max(120, 'Use no máximo 120 caracteres');
export const accountTypeSchema = z.enum(
  ['CHECKING', 'SAVINGS', 'CASH', 'INVESTMENT', 'OTHER'],
  { error: 'Selecione um tipo de conta válido' },
);
export const categoryTypeSchema = z.enum(['INCOME', 'EXPENSE'], {
  error: 'Selecione receita ou despesa',
});
// Strings são o contrato preferido. Números JSON só são aceitos em faixa segura.
export const moneySchema = z
  .union([
    z.string(),
    z
      .number()
      .finite()
      .refine(
        (v) => Math.abs(v) <= Number.MAX_SAFE_INTEGER / 100,
        'Envie valores grandes como texto',
      )
      .transform(String),
  ])
  .pipe(
    z
      .string()
      .regex(
        /^-?(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/,
        'Informe um valor com até duas casas decimais',
      ),
  );
export const createAccountSchema = z
  .object({
    name: resourceName,
    type: accountTypeSchema,
    initialBalance: moneySchema.default('0'),
    currency: z.literal('BRL').default('BRL'),
    ownerMemberId: uuidSchema.nullable().optional(),
  })
  .strict();
export const updateAccountSchema = createAccountSchema
  .partial()
  .extend({
    initialBalance: moneySchema.optional(),
    currency: z.literal('BRL').optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo');
export const createCategorySchema = z
  .object({
    name: resourceName,
    type: categoryTypeSchema,
    parentId: uuidSchema.nullable().optional(),
  })
  .strict();
export const updateCategorySchema = createCategorySchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo');
export const resourceListSchema = z
  .object({
    includeInactive: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();
export type CreateAccount = z.infer<typeof createAccountSchema>;
export type UpdateAccount = z.infer<typeof updateAccountSchema>;
export type CreateCategory = z.infer<typeof createCategorySchema>;
export type UpdateCategory = z.infer<typeof updateCategorySchema>;
