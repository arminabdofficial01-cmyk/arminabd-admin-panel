import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useTheme } from "next-themes";

export default function Settings() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;

    async function loadProfile() {
      const { data, error } = await supabase
        .from("profiles")
        .select("name, email")
        .eq("id", user.id)
        .single();

      if (error) {
        toast.error(`Failed to load profile: ${error.message}`);
        return;
      }

      setName(data?.name || user.user_metadata?.name || "");
      setEmail(data?.email || user.email || "");
    }

    void loadProfile();
  }, [user]);

  async function handleUpdateProfile() {
    if (!user?.id) return;

    setSaving(true);

    if (name) {
      const { error } = await supabase.from("profiles").update({ name }).eq("id", user.id);
      if (error) {
        toast.error(error.message);
        setSaving(false);
        return;
      }
    }

    if (email && email !== user.email) {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) {
        toast.error(error.message);
        setSaving(false);
        return;
      }
    }

    toast.success("Profile updated");
    setSaving(false);
  }

  async function handleChangePassword() {
    if (!user?.email || !newPassword) return;

    if (!currentPassword) {
      toast.error("Current password is required");
      return;
    }

    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }

    setSaving(true);

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (verifyError) {
      toast.error("Current password is incorrect");
      setSaving(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password updated");
      setNewPassword("");
      setCurrentPassword("");
    }

    setSaving(false);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl sm:text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Update Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={user?.user_metadata?.name || "Enter name"} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={user?.email} />
          </div>
          <Button onClick={handleUpdateProfile} disabled={saving}>Save Changes</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Change Password</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Current Password</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>New Password</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <Button
            onClick={handleChangePassword}
            disabled={saving || !newPassword || !currentPassword}
          >
            Update Password
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <Label>Dark Mode</Label>
            <Switch checked={theme === "dark"} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
