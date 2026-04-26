import { AdminProtectedRoute } from "@/components/auth/AdminProtectedRoute";
import { AdminSidebar } from "./AdminSidebar";
import { NodeOfflineNotifier } from "./NodeOfflineNotifier";
import { AdminTopbar } from "./AdminTopbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AdminProtectedRoute>
      <NodeOfflineNotifier />
      <div className="min-h-screen lg:flex">
        <AdminSidebar />
        <div className="min-w-0 flex-1">
          <AdminTopbar />
          <main className="mx-auto w-full max-w-[1500px] px-5 py-6 lg:px-8">{children}</main>
        </div>
      </div>
    </AdminProtectedRoute>
  );
}
