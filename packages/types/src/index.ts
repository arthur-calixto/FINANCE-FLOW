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
