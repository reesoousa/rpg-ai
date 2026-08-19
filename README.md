# rpg-ai

Motor de jogo para **RPG de mesa solo**, mestrado por IA. PWA mobile-first, estático,
com toda a inteligência atrás de Edge Functions.

## Stack

- **Frontend:** Vite + React + TypeScript + Tailwind CSS v4 + shadcn/ui
- **BaaS:** Supabase (Auth, Postgres + RLS, Storage, Edge Functions)
- **LLM:** Gemini (context caching + output estruturado), atrás de Edge Function
- **Deploy:** GitHub Pages via GitHub Actions

## Status

Em setup. Ver `docs/design/DESIGN.md` para o design system.

## Chaves de API

Nenhuma chave de LLM existe no frontend. Todas vivem como secrets das Edge Functions.
