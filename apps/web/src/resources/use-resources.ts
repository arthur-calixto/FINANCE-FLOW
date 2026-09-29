import { useEffect, useState } from 'react';
import { apiRequest } from '../api';
export function useResources<T>(path: string, workspaceId: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest(`${path}?includeInactive=true`, workspaceId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setRows(result as T[]);
          setLoading(false);
          setError('');
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            e instanceof Error ? e.message : 'Não foi possível carregar.',
          );
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [path, workspaceId, revision]);
  return {
    rows,
    loading,
    error,
    reload: () => {
      setLoading(true);
      setError('');
      setRevision((n) => n + 1);
    },
  };
}
