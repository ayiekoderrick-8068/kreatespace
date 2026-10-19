import { NavLink, Outlet } from "react-router";

const tab = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-1 pb-2 text-sm font-medium ${isActive ? "border-terracotta text-ink" : "border-transparent text-ink-muted hover:text-ink"}`;

export function AdminLayout() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
      <nav aria-label="Admin sections" className="mt-4 flex gap-6 border-b border-cream-dark">
        <NavLink to="/admin/businesses" className={tab}>
          Businesses
        </NavLink>
        <NavLink to="/admin/creations" className={tab}>
          Creations
        </NavLink>
        <NavLink to="/admin/invitations" className={tab}>
          Invitations
        </NavLink>
      </nav>
      <div className="mt-6">
        <Outlet />
      </div>
    </main>
  );
}
