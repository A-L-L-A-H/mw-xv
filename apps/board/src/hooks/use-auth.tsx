import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { readPreferences } from '@/lib/preferences';
import { AuthContext, type AuthValue } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState(client.currentUser);
  const queryClient = useQueryClient();
  const userId = useRef(client.currentUser?.id ?? null);

  useEffect(() => {
    document.documentElement.lang = readPreferences().language;
  }, []);

  useEffect(
    () =>
      client.onSessionChange((next) => {
        const nextUserId = next?.id ?? null;
        if (userId.current !== nextUserId) queryClient.clear();
        userId.current = nextUserId;
        setUser(next);
      }),
    [queryClient]
  );

  useEffect(() => {
    let active = true;
    void client.ready().then(() => {
      if (!active) return;
      const restoredUser = client.currentUser;
      const restoredUserId = restoredUser?.id ?? null;
      if (userId.current !== restoredUserId) queryClient.clear();
      userId.current = restoredUserId;
      setUser(restoredUser);
    });
    return () => {
      active = false;
    };
  }, [queryClient]);

  const value: AuthValue = {
    user,
    login: async (params) => void (await client.login(params)),
    register: async (params) => void (await client.register(params)),
    logout: () => client.logout(),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
