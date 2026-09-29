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
