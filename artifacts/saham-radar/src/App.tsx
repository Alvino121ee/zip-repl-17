import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/Layout";
import XauusdAi from "@/pages/xauusd-ai";
import BtcusdAi from "@/pages/btcusd-ai";
import AdminPanel from "@/pages/admin";
import LoginMemberPage from "@/pages/login-member";
import LoginAdminPage from "@/pages/login-admin";
import RegisterPage from "@/pages/register";
import VerifyEmailPage from "@/pages/verify-email";
import MemberPage from "@/pages/member";
import HomePage from "@/pages/home";
import PricingPage from "@/pages/pricing";
import PaymentPage from "@/pages/payment";
import { getAdminToken } from "@/lib/auth";

// ── Wrapper: halaman admin hanya bisa diakses saat sudah login ────────────────
function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const [, navigate] = useLocation();
  const token = getAdminToken();

  useEffect(() => {
    if (!token) navigate("/login/admin?redirect=/admin");
  }, [token, navigate]);

  if (!token) return null;
  return <Component />;
}

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
      {/* Halaman publik & tanpa sidebar */}
      <Route path="/" component={HomePage} />
      <Route path="/login/member" component={LoginMemberPage} />
      <Route path="/login/admin" component={LoginAdminPage} />
      <Route path="/login">
        {() => { window.location.replace("/login/member" + window.location.search); return null; }}
      </Route>
      <Route path="/register" component={RegisterPage} />
      <Route path="/verify-email" component={VerifyEmailPage} />
      <Route path="/member" component={MemberPage} />
      <Route path="/pricing" component={PricingPage} />
      <Route path="/payment/:orderId" component={PaymentPage} />

      {/* Halaman admin dengan layout sidebar — wajib login admin */}
      <Route>
        <Layout>
          <Switch>
            <Route path="/admin">
              <AdminRoute component={XauusdAi} />
            </Route>
            <Route path="/admin/btc">
              <AdminRoute component={BtcusdAi} />
            </Route>
            <Route path="/admin/settings">
              <AdminRoute component={AdminPanel} />
            </Route>
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
