import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, useState, type ComponentType } from "react";
import { Navigate, RouterProvider, createBrowserRouter, type RouteObject } from "react-router";
import { AuthProvider } from "./auth/AuthProvider";
import { Layout } from "./components/Layout";
import { RequireRole } from "./components/RequireRole";
import { AboutPage } from "./pages/AboutPage";
import { AccountPage } from "./pages/AccountPage";
import { CreationPage } from "./pages/CreationPage";
import { ExplorePage } from "./pages/ExplorePage";
import { ForBusinessesPage } from "./pages/ForBusinessesPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PublicBusinessPage } from "./pages/PublicBusinessPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SavedPage } from "./pages/SavedPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";

// Private areas (admin, seller tools, invitations) load only when visited, so the public pages
// that most visitors see ship less JavaScript on mobile networks.
function lazyPage<T extends Record<string, ComponentType>>(load: () => Promise<T>, name: keyof T) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}
const AdminLayout = lazyPage(() => import("./pages/admin/AdminLayout"), "AdminLayout");
const BusinessesPage = lazyPage(() => import("./pages/admin/BusinessesPage"), "BusinessesPage");
const BusinessReviewPage = lazyPage(
  () => import("./pages/admin/BusinessReviewPage"),
  "BusinessReviewPage",
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
export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  {
    element: <Layout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/explore", element: <ExplorePage /> },
      { path: "/creations/:id", element: <CreationPage /> },
      { path: "/saved", element: <SavedPage /> },
      { path: "/about", element: <AboutPage /> },
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
          { path: "invitations", element: <InvitationsPage /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
