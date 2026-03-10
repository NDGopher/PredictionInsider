import { LayoutDashboard, Users, Zap, BarChart3, TrendingUp, BookOpen } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, badge: null },
  { title: "Live Signals", url: "/signals", icon: Zap, badge: "LIVE" },
  { title: "Top Traders", url: "/traders", icon: Users, badge: null },
  { title: "Markets", url: "/markets", icon: BarChart3, badge: null },
  { title: "My Bets", url: "/bets", icon: BookOpen, badge: null },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
            <TrendingUp className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <div className="font-bold text-sm leading-tight tracking-tight">PredictionInsider</div>
            <div className="text-[10px] text-muted-foreground leading-tight">Polymarket Intelligence</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mb-0.5">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = item.url === "/" ? location === "/" : location.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <Link href={item.url} className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <item.icon className="w-4 h-4" />
                          <span className="text-sm">{item.title}</span>
                        </div>
                        {item.badge && (
                          <Badge variant="default" className="text-[9px] px-1.5 py-0 h-4">
                            {item.badge}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-2">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mb-0.5">
            Data Sources
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="px-2 space-y-1.5">
              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-muted-foreground">Polymarket</span>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <span className="text-green-600 dark:text-green-400 text-[10px]">Live</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-muted-foreground">CLOB Prices</span>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <span className="text-green-600 dark:text-green-400 text-[10px]">Live</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-muted-foreground">Leaderboard</span>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                  <span className="text-yellow-600 dark:text-yellow-400 text-[10px]">5m cache</span>
                </div>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-3 py-3">
        <div className="text-[10px] text-muted-foreground leading-relaxed px-1">
          Data sourced from Polymarket public APIs. Not financial advice.
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
