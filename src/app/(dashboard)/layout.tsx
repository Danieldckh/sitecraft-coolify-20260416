export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-black/5 bg-paper-raised/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-ink" />
            <span className="font-semibold tracking-tight">Sitecraft</span>
          </div>
          <nav className="text-sm text-ink-soft/70">
            <a href="/sites" className="hover:text-ink">Sites</a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
