import { createBrowserRouter } from 'react-router'
import { AppShell } from './layouts/AppShell'
import { PagePlaceholder } from '@/components/PagePlaceholder'
import { HomePage } from '@/features/marketing/HomePage'

// GitHub Pages serve em /<repo>/. O 404.html do build faz o fallback de SPA.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

export const router = createBrowserRouter(
  [
    {
      element: <AppShell />,
      children: [
        // A vitrine e a primeira coisa que carrega: fica no bundle inicial.
        { path: '/', element: <HomePage /> },
        {
          // A engine carrega react-markdown e o resto do peso. Sai do caminho
          // critico de quem so abriu a home.
          path: '/jogar',
          lazy: async () => {
            const { GamePage } = await import('@/features/engine/GamePage')
            return { Component: GamePage }
          },
        },
        {
          path: '/dashboard',
          element: (
            <PagePlaceholder
              title="Suas campanhas"
              planned={[
                'Historico de campanhas salvas',
                'Criacao de personagem por wizard de chat',
                'Retomar de onde parou',
              ]}
            />
          ),
        },
        {
          path: '/perfil',
          element: (
            <PagePlaceholder
              title="Perfil"
              planned={['Login por magic link', 'Preferencias', 'Tema']}
            />
          ),
        },
        {
          path: '/admin',
          element: (
            <PagePlaceholder
              title="Painel do mestre"
              planned={[
                'Upload de livros base em PDF',
                'Geracao do Context Cache ID do Gemini',
                'Fabrica de campanhas: texto solto para JSON estrito',
              ]}
            />
          ),
        },
        {
          path: '*',
          element: (
            <PagePlaceholder
              title="Pagina nao encontrada"
              planned={['Voltar ao inicio']}
            />
          ),
        },
      ],
    },
  ],
  { basename },
)
