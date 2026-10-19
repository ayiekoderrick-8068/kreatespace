import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, RouterProvider, createBrowserRouter, type RouteObject } from "react-router";
import { AuthProvider } from "./auth/AuthProvider";
import { Layout } from "./components/Layout";
import { RequireRole } from "./components/RequireRole";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AboutPage } from "./pages/AboutPage";
import { AccountPage } from "./pages/AccountPage";
import { CreationPage } from "./pages/CreationPage";
import { ExplorePage } from "./pages/ExplorePage";
import { ForBusinessesPage } from "./pages/ForBusinessesPage";
import { BusinessReviewPage } from "./pages/admin/BusinessReviewPage";
import { BusinessesPage } from "./pages/admin/BusinessesPage";
import { InvitationsPage } from "./pages/admin/InvitationsPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { HomePage } from "./pages/HomePage";
import { InvitePage } from "./pages/InvitePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PublicBusinessPage } from "./pages/PublicBusinessPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SavedPage } from "./pages/SavedPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SellerDashboardPage } from "./pages/seller/SellerDashboardPage";
import { SellerEditPage } from "./pages/seller/SellerEditPage";
import { SellerRegisterPage } from "./pages/seller/SellerRegisterPage";

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
