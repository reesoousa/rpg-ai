import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Turno de jogo custa tokens: nada de refetch automatico ao focar.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
