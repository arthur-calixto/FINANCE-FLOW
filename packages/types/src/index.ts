export interface HealthResponse {
  status: 'ok';
}

export interface DomainUser {
  id: string;
  email: string;
  name: string;
}
export interface WorkspaceSummary {
  id: string;
  name: string;
  type: 'PERSONAL' | 'FAMILY' | 'BUSINESS';
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
}
export interface MeResponse {
  user: DomainUser;
  workspaces: WorkspaceSummary[];
}

export type AccountType =
  'CHECKING' | 'SAVINGS' | 'CASH' | 'INVESTMENT' | 'OTHER';
export type CategoryType = 'INCOME' | 'EXPENSE';
export interface AccountRecord {
  id: string;
  workspaceId: string;
  name: string;
  type: AccountType;
  initialBalance: string;
  currency: 'BRL';
  ownerMemberId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface CategoryRecord {
  id: string;
  workspaceId: string;
  name: string;
  type: CategoryType;
  parentId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TransactionStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export interface TransactionRecord {
  recurrenceId?: string | null;
  recurrenceDate?: string | null;
  installmentGroupId?: string | null;
  installmentNumber?: number | null;
  installmentGroup?: { id: string; installmentCount: number } | null;
  creditCardId?: string | null;
  invoiceId?: string | null;
  creditCard?: { id: string; name: string } | null;
  invoice?: {
    id: string;
    referenceMonth: string;
    dueDate?: string;
    status?: InvoiceRecord['status'];
  } | null;
  permanentDeleteBlockedReason?: string | null;
  id: string;
  workspaceId: string;
  description: string;
  type: CategoryType;
  status: TransactionStatus;
  expectedAmount: string | null;
  amount: string | null;
  transactionDate: string;
  competenceDate: string;
  dueDate: string;
  paidAt: string | null;
  accountId: string | null;
  categoryId: string | null;
  ownerMemberId: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  account: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
}
export interface TransactionSummary {
  income: { expected: string; realized: string };
  expense: { expected: string; realized: string };
}
export function brazilToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export interface InvoicePreview {
  referenceMonth: string;
  closingDate: string;
  dueDate: string;
}
export interface InvoiceRecord extends InvoicePreview {
  id: string;
  workspaceId: string;
  creditCardId: string;
  status: 'OPEN' | 'CLOSED' | 'PAID' | 'OVERDUE';
  total: string;
  purchaseCount: number;
  paidAt: string | null;
  paidAmount: string | null;
  paymentAccountId: string | null;
  paymentAccount?: { id: string; name: string } | null;
}
export interface CreditCardRecord {
  id: string;
  workspaceId: string;
  name: string;
  creditLimit: string;
  closingDay: number;
  dueDay: number;
  isActive: boolean;
  usedLimit: string;
  availableLimit: string;
  currentInvoice: InvoiceRecord | null;
}
export interface InvoiceDetail extends InvoiceRecord {
  creditCard: { id: string; name: string };
  purchases: TransactionRecord[];
}

export interface InstallmentPlanRow {
  installmentNumber: number;
  amount: string;
  dueDate: string;
  competenceDate: string;
  closingDate?: string;
}
export interface InstallmentControl {
  startingInstallment: number;
  previousInstallmentCount: number;
  controlledInstallmentCount: number;
  controlledAmount: string;
}
export interface InstallmentPlan extends InstallmentControl {
  installmentCount: number;
  totalAmount: string;
  installments: InstallmentPlanRow[];
  availableBefore?: string;
  availableAfter?: string;
}
export interface InstallmentGroupRecord extends InstallmentControl {
  id: string;
  workspaceId: string;
  description: string;
  totalAmount: string;
  installmentCount: number;
  purchaseDate: string;
  type: CategoryType;
  origin: 'ACCOUNT' | 'CREDIT_CARD';
  accountId: string | null;
  creditCardId: string | null;
  account: { id: string; name: string } | null;
  creditCard: { id: string; name: string } | null;
  installments: TransactionRecord[];
}

export interface RecurrencePreview {
  from: string;
  until: string;
  occurrences: {
    dueDate: string;
    competenceDate: string;
    expectedAmount: string;
  }[];
}
export interface RecurrenceRecord {
  id: string;
  description: string;
  type: CategoryType;
  expectedAmount: string;
  frequency: 'MONTHLY' | 'YEARLY';
  interval: number;
  dueDay: number;
  startDate: string;
  endDate: string | null;
  nextDueDate: string | null;
  status: 'ACTIVE' | 'ENDING' | 'ENDED';
  isActive: boolean;
  accountId: string;
  categoryId: string;
  account: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  notes: string | null;
}
export interface RecurrenceDetail extends RecurrenceRecord {
  occurrences: TransactionRecord[];
  revisions: {
    effectiveDate: string;
    expectedAmount: string;
    description: string;
  }[];
}

export interface TransactionTotals {
  expected: string;
  realized: string;
}
export interface TransactionMonthView {
  rows: TransactionRecord[];
  summary: TransactionSummary;
  subtotals: Record<string, TransactionTotals>;
}
/** Origem real; parcelamento não é uma seção financeira separada. */
export function transactionGroupKey(
  row: Pick<TransactionRecord, 'type' | 'recurrenceId' | 'creditCardId'>,
): string {
  if (row.type === 'INCOME')
    return row.recurrenceId ? 'incomeFixed' : 'incomeOther';
  if (row.creditCardId) return 'card:' + row.creditCardId;
  return row.recurrenceId ? 'expenseFixed' : 'expenseOther';
}

export type TransactionDeletionScope = 'THIS' | 'THIS_AND_FUTURE' | 'ALL';
export interface TransactionDeletionOption {
  scope: TransactionDeletionScope;
  count: number;
  firstInstallment: number | null;
  lastInstallment: number | null;
}
export interface TransactionDeletionOptions {
  options: TransactionDeletionOption[];
  blockedReason: string | null;
  installmentCount: number | null;
}
export interface TransactionDeletionResult {
  id: string;
  deleted: true;
  deletedCount: number;
  deletedInvoiceIds: string[];
}
