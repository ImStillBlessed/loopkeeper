import { lazy, Suspense } from "react";
import { Shell } from "@/components/shell";
import { TicketSheet } from "@/components/ticket-sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loading } from "@/components/page";
import { api } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LiveProvider, useLiveQuery } from "@/lib/live";
import { useRoute } from "@/lib/router";
import { AnalyticsPage } from "@/pages/analytics";
import { AskPage } from "@/pages/ask";
import { ClientPage } from "@/pages/client";
import { ClientsPage } from "@/pages/clients";
import { ConversationsPage } from "@/pages/conversations";
import { LoginPage } from "@/pages/login";
import { OverviewPage } from "@/pages/overview";
import { PatternsPage } from "@/pages/patterns";
import { ProductsPage } from "@/pages/products";
import { SettingsPage } from "@/pages/settings";
import { TicketsPage } from "@/pages/tickets";

// The 3D graph library is large, so the Network page loads only when someone opens it.
const NetworkPage = lazy(() => import("@/pages/network").then((m) => ({ default: m.NetworkPage })));

export function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <Gate />
      </TooltipProvider>
    </AuthProvider>
  );
}

/** Signed out → login. Signed in → the desk, connected to the live event stream. */
function Gate() {
  const { user } = useAuth();
  if (user === undefined) return <Loading label="Opening the desk" />;
  if (user === null) return <LoginPage />;
  return (
    <LiveProvider key={user.id}>
      <Desk />
    </LiveProvider>
  );
}

function Desk() {
  const { user } = useAuth();
  const { data: overview } = useLiveQuery(api.overview);
  // Hub messages waiting for a person to route them (only roles that see the hub).
  const seesHub = user?.role === "admin" || user?.role === "lead" || user?.role === "developer";
  const { data: hub } = useLiveQuery(() => (seesHub ? api.hub() : Promise.resolve(undefined)), [seesHub]);
  const badges = { tickets: overview?.kpis.breached, conversations: hub?.pending };
  return (
    <Shell badges={badges}>
      <Pages />
      <TicketSheet />
    </Shell>
  );
}

/** #/page/... → the page. */
function Pages() {
  const { path, query } = useRoute();
  const [page = "overview", id, tab] = path;
  switch (page) {
    case "tickets":
      return <TicketsPage />;
    case "clients":
      return id ? <ClientPage key={id} clientId={id} tab={tab ?? "overview"} /> : <ClientsPage />;
    case "conversations":
      return <ConversationsPage clientId={id} />;
    case "ask":
      return <AskPage scope={query.get("scope") ?? "hq"} conversationId={query.get("c") ?? undefined} />;
    case "patterns":
      return <PatternsPage />;
    case "analytics":
      return <AnalyticsPage />;
    case "network":
      return (
        <Suspense fallback={<Loading label="Drawing the graph" />}>
          <NetworkPage key={id} clientId={id} />
        </Suspense>
      );
    case "products":
      return <ProductsPage />;
    case "settings":
      return <SettingsPage section={query.get("section") ?? "team"} />;
    default:
      return <OverviewPage />;
  }
}
