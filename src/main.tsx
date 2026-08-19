import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { Providers } from './app/providers'
import { router } from './app/router'
import { initTheme } from './lib/theme'
import { recarregarQuandoAtualizar } from './lib/sw-update'
import './index.css'

// Antes do render, para nao piscar o tema errado.
initTheme()

// Deploy novo aparece sem o usuario precisar fechar o app.
recarregarQuandoAtualizar()

const root = document.getElementById('root')
if (!root) throw new Error('#root nao encontrado')

createRoot(root).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
