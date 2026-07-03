import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/Layout";
import XauusdAi from "@/pages/xauusd-ai";
import AdminPanel from "@/pages/admin";
import LoginPage from "@/pages/login";
import MemberPage from "@/pages/member";

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
    <Switch>
      {/* Halaman tanpa layout sidebar */}
      <Route path="/login" component={LoginPage} />
      <Route path="/member" component={MemberPage} />

      {/* Halaman dengan layout sidebar */}
      <Route>
        <Layout>
          <Switch>
            <Route path="/" component={XauusdAi} />
            <Route path="/admin" component={AdminPanel} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
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
