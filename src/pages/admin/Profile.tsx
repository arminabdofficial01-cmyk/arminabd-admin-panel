import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { User, Shield, Calendar } from "lucide-react";
import { toast } from "sonner";

type ProfileType = Database["public"]["Tables"]["profiles"]["Row"];

export default function Profile() {
  const { user, isAdmin } = useAuth();

  const [profile, setProfile] = useState<ProfileType | null>(null);
  const [orderCount, setOrderCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      setLoading(true);

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profileError) {
        toast.error(`Failed to load profile: ${profileError.message}`);
        setLoading(false);
        return;
      }

      setProfile(profileData);

      const { count, error: ordersError } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true });

      if (ordersError) {
        toast.error(`Failed to load order count: ${ordersError.message}`);
      } else {
        setOrderCount(count ?? 0);
      }

      setLoading(false);
    };

    void fetchData();
  }, [user]);

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading profile...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl sm:text-2xl font-bold">Profile</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Admin Info
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center">
            <span className="text-sm text-muted-foreground">Name</span>
            <span className="font-medium break-words text-right sm:text-left">{profile?.name ?? "—"}</span>
          </div>

          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="font-medium break-all text-right sm:text-left">
              {profile?.email ?? user?.email ?? "—"}
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
            <span className="text-sm text-muted-foreground">Role</span>
            <Badge>
              <Shield className="h-3 w-3 mr-1" />
              {isAdmin ? "Admin" : "User"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Account Details
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center">
            <span className="text-sm text-muted-foreground">Created</span>
            <span className="font-medium text-right sm:text-left">
              {user?.created_at
                ? format(new Date(user.created_at), "MMM dd, yyyy")
                : "—"}
            </span>
          </div>

          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center">
            <span className="text-sm text-muted-foreground">
              Last Sign In
            </span>
            <span className="font-medium text-right sm:text-left">
              {user?.last_sign_in_at
                ? format(new Date(user.last_sign_in_at), "MMM dd, yyyy HH:mm")
                : "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity Summary</CardTitle>
        </CardHeader>

        <CardContent>
          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center">
            <span className="text-sm text-muted-foreground">
              Total Orders Managed
            </span>
            <span className="font-bold text-lg">{orderCount}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
