import { useEffect, useState } from 'react';
import { apiRequest } from '../api';
export function useCardData<T>(path: string, workspaceId: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest(path, workspaceId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result as T);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : 'Não foi possível carregar.',
          );
      });
    return () => controller.abort();
  }, [path, workspaceId, revision]);
  return {
    data,
    error,
    reload: () => {
      setData(null);
      setError('');
      setRevision((n) => n + 1);
    },
  };
}
