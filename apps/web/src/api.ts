import { supabase } from './supabase';
import { meSchema, workspaceSchema } from '@finance-flow/validation';
export class ApiError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? 'Sessão inválida. Entre novamente.'
        : status === 403
          ? 'Você não tem acesso a este workspace.'
          : 'Não foi possível carregar seus dados. Tente novamente.',
    );
  }
}
export async function apiRequest(
  path: string,
  workspaceId?: string,
  signal?: AbortSignal,
) {
  const { data } = await supabase!.auth.getSession();
  if (!data.session) throw new ApiError(401);
  const response = await fetch(
    `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}${path}`,
    {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      },
      signal,
    },
  );
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<unknown>;
}
export async function getMe(signal?: AbortSignal) {
  return meSchema.parse(await apiRequest('/me', undefined, signal));
}
export async function selectWorkspace(id: string) {
  return workspaceSchema.parse(
    await apiRequest(`/workspaces/${encodeURIComponent(id)}`, id),
  );
}
