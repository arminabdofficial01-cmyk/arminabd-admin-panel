import { Outlet } from "react-router-dom";
import { AdminMobileSidebar, AdminSidebar } from "./AdminSidebar";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AdminLayout() {
  const { signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar
        onSignOut={signOut}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        className="hidden md:flex"
      />

      <AdminMobileSidebar
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        onSignOut={signOut}
      />

      <div
        className={cn(
          "min-h-screen flex flex-col transition-[margin] duration-200",
          collapsed ? "md:ml-16" : "md:ml-60"
        )}
      >
        <header className="sticky top-0 z-40 flex md:hidden items-center gap-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-semibold truncate">Armina Admin Panel</span>
        </header>

        <main className="flex-1 p-4 sm:p-6 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
