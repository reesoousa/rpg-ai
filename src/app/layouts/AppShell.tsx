import { Outlet } from 'react-router'
import { FloatingNav } from '@/components/FloatingNav'

export function AppShell() {
  return (
    <div className="min-h-dvh">
      {/* pb: espaco para a nav flutuante nao cobrir conteudo */}
      <main className="mx-auto w-full max-w-2xl px-4 pt-6 pb-32">
        <Outlet />
      </main>
      <FloatingNav />
    </div>
  )
}
