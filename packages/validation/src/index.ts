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

export const civilDateSchema = z.iso
  .date()
  .refine((v) => v >= '0001-01-01', 'Data inválida');
export const monthSchema = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/);
export const positiveMoneySchema = moneySchema.refine(
  (v) => !v.startsWith('-') && /[1-9]/.test(v),
  'O valor deve ser positivo',
);
const transactionFields = z
  .object({
    description: z.string().trim().min(1).max(500),
    type: categoryTypeSchema,
    expectedAmount: positiveMoneySchema.nullable().optional(),
    amount: positiveMoneySchema.nullable().optional(),
    transactionDate: civilDateSchema,
    dueDate: civilDateSchema,
    accountId: uuidSchema,
    categoryId: uuidSchema,
    ownerMemberId: uuidSchema.nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();
export const createTransactionSchema = transactionFields.refine(
  (v) => v.expectedAmount != null || v.amount != null,
  'Informe valor previsto ou realizado',
);
export const updateTransactionSchema = transactionFields
  .partial()
  .extend({ recurrenceScope: z.literal('ONE').optional() })
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo');
export const payTransactionSchema = z
  .object({
    amount: positiveMoneySchema.optional(),
    paidAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const transactionListSchema = z
  .object({
    month: monthSchema.optional(),
    type: categoryTypeSchema.optional(),
    status: z.enum(['PENDING', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
    accountId: uuidSchema.optional(),
    categoryId: uuidSchema.optional(),
    search: z.string().trim().max(200).optional(),
  })
  .strict();
export const transactionSummarySchema = z
  .object({ month: monthSchema })
  .strict();
export type CreateTransaction = z.infer<typeof createTransactionSchema>;
export type UpdateTransaction = z.infer<typeof updateTransactionSchema>;
export type PayTransaction = z.infer<typeof payTransactionSchema>;
export type TransactionQuery = z.infer<typeof transactionListSchema>;

export const nonnegativeMoneySchema = moneySchema.refine(
  (v) => !v.startsWith('-'),
  'O valor não pode ser negativo',
);
const cardFields = z
  .object({
    name: resourceName,
    creditLimit: nonnegativeMoneySchema,
    closingDay: z.number().int().min(1).max(31),
    dueDay: z.number().int().min(1).max(31),
  })
  .strict();
export const createCreditCardSchema = cardFields;
export const updateCreditCardSchema = cardFields
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo');
export const createPurchaseSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    amount: positiveMoneySchema,
    transactionDate: civilDateSchema,
    categoryId: uuidSchema,
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();
export const purchasePreviewSchema = z
  .object({ transactionDate: civilDateSchema })
  .strict();
export const invoiceListSchema = z
  .object({ month: monthSchema.optional() })
  .strict();
export const payInvoiceSchema = z
  .object({
    accountId: uuidSchema,
    amount: positiveMoneySchema.optional(),
    paidAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type CreateCreditCard = z.infer<typeof createCreditCardSchema>;
export type UpdateCreditCard = z.infer<typeof updateCreditCardSchema>;
export type CreatePurchase = z.infer<typeof createPurchaseSchema>;
export type PayInvoice = z.infer<typeof payInvoiceSchema>;

export const installmentCountSchema = z.number().int().min(1).max(120);
const installmentValues = {
  amountMode: z.enum(['TOTAL', 'INSTALLMENT']).default('TOTAL'),
  totalAmount: positiveMoneySchema.optional(),
  installmentAmount: positiveMoneySchema.optional(),
  installmentCount: installmentCountSchema,
  startingInstallment: installmentCountSchema.default(1),
};
function validateInstallmentValues(
  v: {
    amountMode: string;
    totalAmount?: string;
    installmentAmount?: string;
    installmentCount: number;
    startingInstallment: number;
  },
  ctx: z.RefinementCtx,
) {
  if (
    v.amountMode === 'TOTAL'
      ? !v.totalAmount || v.installmentAmount !== undefined
      : !v.installmentAmount || v.totalAmount !== undefined
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Informe somente o valor correspondente ao modo selecionado.',
      path: [v.amountMode === 'TOTAL' ? 'totalAmount' : 'installmentAmount'],
    });
  if (v.startingInstallment > v.installmentCount)
    ctx.addIssue({
      code: 'custom',
      message: 'A parcela inicial não pode exceder a quantidade total.',
      path: ['startingInstallment'],
    });
}
const cardInstallmentDates = {
  transactionDate: civilDateSchema.optional(),
  firstInvoiceMonth: monthSchema.optional(),
};
function validateCardInstallmentDates(
  v: {
    startingInstallment: number;
    transactionDate?: string;
    firstInvoiceMonth?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (
    v.startingInstallment === 1
      ? !v.transactionDate || v.firstInvoiceMonth !== undefined
      : !v.firstInvoiceMonth
  )
    ctx.addIssue({
      code: 'custom',
      message:
        'Novo parcelamento exige data da compra; em andamento exige primeira fatura controlada.',
      path: [
        v.startingInstallment === 1 ? 'transactionDate' : 'firstInvoiceMonth',
      ],
    });
}
const installmentBase = {
  ...installmentValues,
  description: z.string().trim().min(1).max(500),
  categoryId: uuidSchema,
  notes: z.string().trim().max(5000).nullable().optional(),
};
export const createInstallmentSchema = z
  .object({
    ...installmentBase,
    transactionDate: civilDateSchema,
    type: categoryTypeSchema,
    firstDueDate: civilDateSchema,
    accountId: uuidSchema,
  })
  .strict()
  .superRefine(validateInstallmentValues);
export const createCardInstallmentSchema = z
  .object({ ...installmentBase, ...cardInstallmentDates })
  .strict()
  .superRefine(validateInstallmentValues)
  .superRefine(validateCardInstallmentDates);
export const installmentPreviewSchema = z
  .object({ ...installmentValues, firstDueDate: civilDateSchema })
  .strict()
  .superRefine(validateInstallmentValues);
export const cardInstallmentPreviewSchema = z
  .object({ ...installmentValues, ...cardInstallmentDates })
  .strict()
  .superRefine(validateInstallmentValues)
  .superRefine(validateCardInstallmentDates);
export const cancelInstallmentsSchema = z
  .object({
    fromInstallmentNumber: installmentCountSchema,
    scope: z.enum(['ONE', 'FROM']),
  })
  .strict();
export type CreateInstallment = z.infer<typeof createInstallmentSchema>;
export type CreateCardInstallment = z.infer<typeof createCardInstallmentSchema>;
export type InstallmentPreviewInput = z.infer<typeof installmentPreviewSchema>;
export type CardInstallmentPreviewInput = z.infer<
  typeof cardInstallmentPreviewSchema
>;
export type CancelInstallments = z.infer<typeof cancelInstallmentsSchema>;

export const recurrenceFrequencySchema = z.enum(['MONTHLY', 'YEARLY']);
const recurrenceDefaults = {
  description: z.string().trim().min(1).max(500),
  expectedAmount: positiveMoneySchema,
  accountId: uuidSchema,
  categoryId: uuidSchema,
  notes: z.string().trim().max(5000).nullable().optional(),
};
const recurrenceCalendar = {
  frequency: recurrenceFrequencySchema,
  firstDueDate: civilDateSchema,
  interval: z.number().int().min(1).max(120).default(1),
};
export const recurrencePreviewSchema = z
  .object({ ...recurrenceCalendar, expectedAmount: positiveMoneySchema })
  .strict();
export const createRecurrenceSchema = z
  .object({
    ...recurrenceDefaults,
    ...recurrenceCalendar,
    type: categoryTypeSchema,
  })
  .strict();
export const updateRecurrenceSchema = z
  .object(recurrenceDefaults)
  .partial()
  .extend({ fromTransactionId: uuidSchema })
  .strict()
  .refine(
    (v) => Object.keys(v).some((k) => k !== 'fromTransactionId'),
    'Informe ao menos uma alteração',
  );
export const endRecurrenceSchema = z
  .object({ fromDate: civilDateSchema })
  .strict();
export type CreateRecurrence = z.infer<typeof createRecurrenceSchema>;
export type UpdateRecurrence = z.infer<typeof updateRecurrenceSchema>;
export type RecurrencePreviewInput = z.infer<typeof recurrencePreviewSchema>;

export const transactionMonthViewSchema = transactionListSchema.extend({
  month: monthSchema,
});
export const permanentlyDeleteTransactionSchema = z
  .object({
    confirm: z.literal(true),
    scope: z.enum(['THIS', 'THIS_AND_FUTURE', 'ALL']).default('THIS'),
    expectedCount: z.number().int().positive().optional(),
  })
  .strict();

export type PermanentlyDeleteTransaction = z.infer<
  typeof permanentlyDeleteTransactionSchema
>;

export const createWorkspaceSchema = z
  .object({ name: resourceName, type: z.literal('FAMILY') })
  .strict();
export const renameWorkspaceSchema = z.object({ name: resourceName }).strict();
export const createInvitationSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    role: z.literal('MEMBER').default('MEMBER'),
  })
  .strict();
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const dashboardQuerySchema = z
  .object({
    month: monthSchema.refine(
      (v) => v >= '0001-06',
      'Selecione um mês com seis competências válidas.',
    ),
  })
  .strict();
