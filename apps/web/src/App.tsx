import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useState, type ComponentType, type ReactElement } from "react";
import {
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation,
  type RouteObject,
} from "react-router";
import { AuthProvider } from "./auth/AuthProvider";
import { AppErrorBoundary, RouteErrorPage } from "./components/ErrorPage";
import { Layout } from "./components/Layout";
import { RequireRole } from "./components/RequireRole";
import { staticMetaFor, usePageMeta } from "./lib/page-meta";
import { AboutPage } from "./pages/AboutPage";
import { CreationPage } from "./pages/CreationPage";
import { ExplorePage } from "./pages/ExplorePage";
import { ForBusinessesPage } from "./pages/ForBusinessesPage";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PublicBusinessPage } from "./pages/PublicBusinessPage";
import { SavedPage } from "./pages/SavedPage";

// Private areas (admin, seller tools, invitations) load only when visited, so the public pages
// that most visitors see ship less JavaScript on mobile networks.
function lazyPage<T extends Record<string, ComponentType>>(load: () => Promise<T>, name: keyof T) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}
// Sign-in and account pages bring the form libraries with them, which browsing never needs.
const AccountPage = lazyPage(() => import("./pages/AccountPage"), "AccountPage");
const ForgotPasswordPage = lazyPage(
  () => import("./pages/ForgotPasswordPage"),
  "ForgotPasswordPage",
);
const TermsPage = lazyPage(() => import("./legal/TermsPage"), "TermsPage");
const PrivacyPage = lazyPage(() => import("./legal/PrivacyPage"), "PrivacyPage");
const SellerTermsPage = lazyPage(() => import("./legal/SellerTermsPage"), "SellerTermsPage");
const LoginPage = lazyPage(() => import("./pages/LoginPage"), "LoginPage");
const RegisterPage = lazyPage(() => import("./pages/RegisterPage"), "RegisterPage");
const ResetPasswordPage = lazyPage(() => import("./pages/ResetPasswordPage"), "ResetPasswordPage");

/** Pages outside the main layout have no loading boundary of their own. */
function standalone(page: ReactElement) {
  return (
    <Suspense
      fallback={
        <p role="status" className="px-4 py-12 text-ink-muted">
          Loading…
        </p>
      }
    >
      {page}
    </Suspense>
  );
}

const AdminLayout = lazyPage(() => import("./pages/admin/AdminLayout"), "AdminLayout");
const BusinessesPage = lazyPage(() => import("./pages/admin/BusinessesPage"), "BusinessesPage");
const BusinessReviewPage = lazyPage(
  () => import("./pages/admin/BusinessReviewPage"),
  "BusinessReviewPage",
);
const CreationsPage = lazyPage(() => import("./pages/admin/CreationsPage"), "CreationsPage");
const CreationReviewPage = lazyPage(
  () => import("./pages/admin/CreationReviewPage"),
  "CreationReviewPage",
);
const PackagesAdminPage = lazyPage(
  () => import("./pages/admin/PackagesAdminPages"),
  "PackagesAdminPage",
);
const PackageReviewPage = lazyPage(
  () => import("./pages/admin/PackagesAdminPages"),
  "PackageReviewPage",
);
const PackagesPage = lazyPage(() => import("./pages/seller/PackagesPage"), "PackagesPage");
const WebsiteRequestPage = lazyPage(
  () => import("./pages/seller/WebsiteRequestPage"),
  "WebsiteRequestPage",
);
const WebsiteRequestsAdminPage = lazyPage(
  () => import("./pages/admin/WebsiteRequestsAdminPage"),
  "WebsiteRequestsAdminPage",
);
const ImportsAdminPage = lazyPage(
  () => import("./pages/admin/ImportsAdminPage"),
  "ImportsAdminPage",
);
const AnalyticsPage = lazyPage(() => import("./pages/seller/AnalyticsPage"), "AnalyticsPage");
const AnalyticsAdminPage = lazyPage(
  () => import("./pages/admin/AnalyticsAdminPage"),
  "AnalyticsAdminPage",
);
const InvitationsPage = lazyPage(() => import("./pages/admin/InvitationsPage"), "InvitationsPage");
const InvitePage = lazyPage(() => import("./pages/InvitePage"), "InvitePage");
const SellerDashboardPage = lazyPage(
  () => import("./pages/seller/SellerDashboardPage"),
  "SellerDashboardPage",
);
const CreationNewPage = lazyPage(
  () => import("./pages/seller/CreationEditorPage"),
  "CreationNewPage",
);
const CreationEditorPage = lazyPage(
  () => import("./pages/seller/CreationEditorPage"),
  "CreationEditorPage",
);
const SellerEditPage = lazyPage(() => import("./pages/seller/SellerEditPage"), "SellerEditPage");
const SellerRegisterPage = lazyPage(
  () => import("./pages/seller/SellerRegisterPage"),
  "SellerRegisterPage",
);
/** Titles and search-engine tags for every page that does not set its own. */
function RouteMeta() {
  const { pathname, search } = useLocation();
  usePageMeta(staticMetaFor(pathname, search));
  return <Outlet />;
}

export const routes: RouteObject[] = [
  { element: <RouteMeta />, errorElement: <RouteErrorPage />, children: pages() },
];

function pages(): RouteObject[] {
  return [
    { path: "/login", element: standalone(<LoginPage />) },
    { path: "/register", element: standalone(<RegisterPage />) },
    { path: "/forgot-password", element: standalone(<ForgotPasswordPage />) },
    { path: "/reset-password", element: standalone(<ResetPasswordPage />) },
    {
      element: <Layout />,
      children: [
        { path: "/", element: <HomePage /> },
        { path: "/explore", element: <ExplorePage /> },
        { path: "/creations/:id", element: <CreationPage /> },
        { path: "/saved", element: <SavedPage /> },
        { path: "/about", element: <AboutPage /> },
        { path: "/terms", element: <TermsPage /> },
        { path: "/privacy", element: <PrivacyPage /> },
        { path: "/seller-terms", element: <SellerTermsPage /> },
        { path: "/for-businesses", element: <ForBusinessesPage /> },
        { path: "/account", element: <AccountPage /> },
        { path: "/invite/:token", element: <InvitePage /> },
        { path: "/businesses/:slug", element: <PublicBusinessPage /> },
        {
          path: "/seller",
          element: (
            <RequireRole roles={["SELLER"]}>
              <SellerDashboardPage />
            </RequireRole>
          ),
        },
        {
          path: "/seller/packages",
          element: (
            <RequireRole roles={["SELLER"]}>
              <PackagesPage />
            </RequireRole>
          ),
        },
        {
          path: "/seller/website",
          element: (
            <RequireRole roles={["SELLER"]}>
              <WebsiteRequestPage />
            </RequireRole>
          ),
        },
        {
          path: "/seller/analytics",
          element: (
            <RequireRole roles={["SELLER"]}>
              <AnalyticsPage />
            </RequireRole>
          ),
        },
        {
          path: "/seller/creations/new",
          element: (
            <RequireRole roles={["SELLER"]}>
              <CreationNewPage />
            </RequireRole>
          ),
        },
        {
          path: "/seller/creations/:id",
          element: (
            <RequireRole roles={["SELLER"]}>
              <CreationEditorPage />
            </RequireRole>
          ),
        },
        {
          path: "/seller/edit",
          element: (
            <RequireRole roles={["SELLER"]}>
              <SellerEditPage />
            </RequireRole>
          ),
        },
        {
          path: "/seller/register",
          element: (
            <RequireRole roles={["SELLER"]}>
              <SellerRegisterPage />
            </RequireRole>
          ),
        },
        {
          path: "/admin",
          element: (
            <RequireRole roles={["ADMIN"]}>
              <AdminLayout />
            </RequireRole>
          ),
          children: [
            { index: true, element: <Navigate to="/admin/businesses" replace /> },
            { path: "businesses", element: <BusinessesPage /> },
            { path: "businesses/:id", element: <BusinessReviewPage /> },
            { path: "creations", element: <CreationsPage /> },
            { path: "creations/:id", element: <CreationReviewPage /> },
            { path: "packages", element: <PackagesAdminPage /> },
            { path: "packages/:id", element: <PackageReviewPage /> },
            { path: "invitations", element: <InvitationsPage /> },
            { path: "analytics", element: <AnalyticsAdminPage /> },
            { path: "website-requests", element: <WebsiteRequestsAdminPage /> },
            { path: "imports", element: <ImportsAdminPage /> },
          ],
        },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ];
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
