import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import * as LucideIcons from "lucide-react";
import { ChevronLeft, ChevronRight, LogOut, LucideIcon } from "lucide-react";
import { ComponentProps } from "react";
import navMenu from "@/lib/navmenu.json";
import { cn } from "@/lib/utils";

type IconName = keyof typeof LucideIcons;

type DynamicIconProps = {
  name: IconName;
} & ComponentProps<LucideIcon>;

const DynamicIcon = ({ name, ...props }: DynamicIconProps) => {
  const Icon = LucideIcons[name] as LucideIcon;

  if (!Icon) {
    return <LucideIcons.HelpCircle {...props} />;
  }

  return <Icon {...props} />;
};

interface SidebarNavProps {
  collapsed?: boolean;
  onSignOut: () => void;
  onNavigate?: () => void;
}

export function SidebarNav({ collapsed = false, onSignOut, onNavigate }: SidebarNavProps) {
  const location = useLocation();

  return (
    <>
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navMenu.map((item) => {
          const isActive = location.pathname === item.href;

          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
              title={collapsed ? item.label : undefined}
            >
              <DynamicIcon
                name={item.icon as IconName}
                className="h-5 w-5 shrink-0"
              />

              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="px-2 pb-4">
        <button
          onClick={() => {
            onNavigate?.();
            onSignOut();
          }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium w-full hover:bg-sidebar-accent/50 text-sidebar-foreground"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </>
  );
}

interface AdminSidebarProps {
  onSignOut: () => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  className?: string;
}

export function AdminSidebar({
  onSignOut,
  collapsed,
  onCollapsedChange,
  className,
}: AdminSidebarProps) {
  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col z-50 transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center h-16 px-4 shrink-0",
          collapsed ? "justify-center" : "justify-between"
        )}
      >
        {!collapsed && (
          <span className="text-lg font-bold tracking-tight text-sidebar-primary truncate">
            Armina Admin
          </span>
        )}

        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      <SidebarNav collapsed={collapsed} onSignOut={onSignOut} />
    </aside>
  );
}

interface AdminMobileSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignOut: () => void;
}

export function AdminMobileSidebar({ open, onOpenChange, onSignOut }: AdminMobileSidebarProps) {
  return (
    <aside
      className={cn(
        "fixed inset-0 z-50 md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0"
        )}
        onClick={() => onOpenChange(false)}
        aria-label="Close navigation menu"
      />
      <div
        className={cn(
          "absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col shadow-xl transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center h-16 px-4 shrink-0 border-b border-sidebar-border">
          <span className="text-lg font-bold tracking-tight text-sidebar-primary">
            Armina Admin
          </span>
        </div>
        <SidebarNav
          onSignOut={onSignOut}
          onNavigate={() => onOpenChange(false)}
        />
      </div>
    </aside>
  );
}
