import { Link, useLocation } from "wouter";
import { Activity, BarChart2, Eye, GitCompare, AlertTriangle, Settings, Target } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: Activity },
    { href: "/screener", label: "Screener", icon: BarChart2 },
    { href: "/picks", label: "Daily Picks", icon: Target },
    { href: "/watchlist", label: "Watchlist", icon: Eye },
    { href: "/compare", label: "Compare", icon: GitCompare },
    { href: "/risk-radar", label: "Risk Radar", icon: AlertTriangle },
    { href: "/admin", label: "Admin", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      {/* Sidebar */}
      <aside className="flex flex-col w-full md:w-64 bg-sidebar border-r border-sidebar-border h-auto md:h-screen sticky top-0">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center font-bold text-white">
            SR
          </div>
          <span className="text-xl font-bold tracking-tight text-white">SahamRadar<span className="text-primary">.ai</span></span>
        </div>
        
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}>
                <item.icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen">
        <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
          {children}
        </div>
        
        {/* Footer Disclaimer */}
        <footer className="border-t border-border p-4 text-center text-xs text-muted-foreground bg-card">
          <p>Disclaimer: SahamRadar AI hanya menyajikan data dan scoring berbasis algoritma. Bukan rekomendasi investasi. Keputusan investasi sepenuhnya tanggung jawab Anda.</p>
        </footer>
      </main>
    </div>
  );
}
