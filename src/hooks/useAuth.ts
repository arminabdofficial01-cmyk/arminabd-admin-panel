import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

async function resolveIsAdmin(currentUser: User | null): Promise<boolean> {
  if (!currentUser) return false;

  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    console.error("Failed to resolve admin role:", error.message);
    return false;
  }

  return Boolean(data);
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function syncSession(sessionUser: User | null) {
      if (cancelled) return;

      setUser(sessionUser);

      if (!sessionUser) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      const admin = await resolveIsAdmin(sessionUser);
      if (cancelled) return;

      setIsAdmin(admin);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      void syncSession(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoading(true);
      void syncSession(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { user, isAdmin, loading, signIn, signOut };
}
