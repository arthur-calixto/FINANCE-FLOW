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
