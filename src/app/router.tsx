import { createBrowserRouter } from 'react-router'
import { AppShell } from './layouts/AppShell'
import { RequireAuth } from './RequireAuth'
import { PagePlaceholder } from '@/components/PagePlaceholder'
import { HomePage } from '@/features/marketing/HomePage'
import { LoginPage } from '@/features/auth/LoginPage'

// GitHub Pages serve em /<repo>/. O 404.html do build faz o fallback de SPA.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

/**
 * A engine e as telas logadas carregam sob demanda: quem chega na vitrine nao
 * deve baixar react-markdown, o Radix e o cliente das functions.
 */
const carregarJogo = async () => {
  const { GamePage } = await import('@/features/engine/GamePage')
  return { Component: GamePage }
}

const carregarDashboard = async () => {
  const { DashboardPage } = await import('@/features/campaigns/DashboardPage')
  return { Component: DashboardPage }
}

const carregarNovaCampanha = async () => {
  const { NewCampaignPage } = await import('@/features/campaigns/NewCampaignPage')
  return { Component: NewCampaignPage }
}

export const router = createBrowserRouter(
  [
    {
      element: <AppShell />,
      children: [
        // --- publico
        { path: '/', element: <HomePage /> },
        { path: '/entrar', element: <LoginPage /> },

        // --- logado
        {
          element: <RequireAuth />,
          children: [
            { path: '/dashboard', lazy: carregarDashboard },
            { path: '/campanha/nova', lazy: carregarNovaCampanha },
            { path: '/campanha/:id/jogar', lazy: carregarJogo },
            {
              path: '/perfil',
              lazy: async () => {
                const { ProfilePage } = await import('@/features/auth/ProfilePage')
                return { Component: ProfilePage }
              },
            },
          ],
        },

        // --- mestre
        {
          element: <RequireAuth exigirMestre />,
          children: [
            {
              path: '/admin',
              lazy: async () => {
                const { AdminPage } = await import('@/features/admin/AdminPage')
                return { Component: AdminPage }
              },
            },
          ],
        },

        {
          path: '*',
          element: (
            <PagePlaceholder title="Pagina nao encontrada" planned={['Voltar ao inicio']} />
          ),
        },
      ],
    },
  ],
  { basename },
)
