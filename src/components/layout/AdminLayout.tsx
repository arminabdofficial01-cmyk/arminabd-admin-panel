import { Outlet } from "react-router-dom";
import { AdminSidebar } from "./AdminSidebar";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";

export function AdminLayout() {
  const { signOut } = useAuth();
  // Sidebar collapsed state is managed internally in AdminSidebar
  // We use ml-60 for expanded (default) but we need to sync
  // For simplicity, the sidebar manages its own state and we use a fixed margin

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar onSignOut={signOut} />
      <main className="ml-60 p-6 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
