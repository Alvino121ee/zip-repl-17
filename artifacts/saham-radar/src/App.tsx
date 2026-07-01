import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/Layout";

// Import Pages
import Dashboard from "@/pages/dashboard";
import Screener from "@/pages/screener";
import StockDetail from "@/pages/stock-detail";
import Watchlist from "@/pages/watchlist";
import Compare from "@/pages/compare";
import RiskRadar from "@/pages/risk-radar";
import Picks from "@/pages/picks";
import AdminPanel from "@/pages/admin";
import AiAnalyst from "@/pages/ai-analyst";
import AgentsPage from "@/pages/agents";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/screener" component={Screener} />
        <Route path="/saham/:ticker" component={StockDetail} />
        <Route path="/watchlist" component={Watchlist} />
        <Route path="/compare" component={Compare} />
        <Route path="/risk-radar" component={RiskRadar} />
        <Route path="/picks" component={Picks} />
        <Route path="/ai-analyst" component={AiAnalyst} />
        <Route path="/agents" component={AgentsPage} />
        <Route path="/admin" component={AdminPanel} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
