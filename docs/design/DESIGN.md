# Design System — rpg-ai

> Fonte da verdade visual. Tokens daqui alimentam `src/index.css` (`@theme` do Tailwind v4).
> Nenhum valor entra aqui sem contraste medido.

## 1. Princípios

1. **Atemático.** Nada de medieval, pergaminho, cyberpunk ou runa. A temática vem do
   texto gerado, não da moldura. A interface é um leitor moderno.
2. **O parágrafo é o produto.** Tudo cede espaço para a narrativa: legibilidade,
   largura de coluna e ritmo vertical vêm antes de qualquer ornamento.
3. **Ação grande e óbvia.** Alvos de toque generosos (>=56px). O jogador joga com uma mão.
4. **Um acento só.** Violeta. O gradiente quente é evento, não fundo.

## 2. Regras anti-genérico (invioláveis)

Estas existem para o app não parecer template gerado. Violação = review reprovado.

| # | Regra | Como resolver em vez disso |
|---|-------|---------------------------|
| 1 | **Sem contorno hairline** (`border-white/10`, `ring-1`) em card, botão ou input | Separar por superfície + sombra |
| 2 | **Sem ícone em box tonal** (quadradinho com acento a 10%) | Ícone solto, 24–28px, na cor do acento |
| 3 | Um acento; nunca dois competindo | Hierarquia por peso e tamanho |
| 4 | Gradiente em no máximo **uma** superfície por tela | Superfície chapada nas outras |
| 5 | Blur só em nav e sheets — nunca card sobre card | Elevação por sombra |
| 6 | Sombra em 2 níveis, não 6 | `--shadow-1`, `--shadow-2` |
| 7 | Movimento 150–200ms `ease-out`, sem bounce/spring | `--ease-out` |
| 8 | Zero emoji como ícone | `lucide-react` |
| 9 | Sem texto centralizado em bloco longo | Alinhado à esquerda |

**Exceção única à regra 1:** `:focus-visible` desenha ring de 2px (WCAG 2.4.11).
Não aparece para mouse/touch.

**Custo assumido:** shadcn/ui gera `Card`, `Button`, `Input` e `Select` com `border`.
Todos precisam ser reescritos na geração. Isso é trabalho do passo de scaffold, não "depois".

## 3. Cor

Origem: paleta medida do rpgpedia.com (referência de linguagem visual — nenhum asset
copiado), com o gradiente quente vindo das refs em `docs/design/refs/`.

### Dark (tema padrão)

| Token | Hex | Contraste medido |
|-------|-----|------------------|
| `--bg` | `#0B0613` + `radial-gradient(#211834 -> #0B0613)` | base |
| `--surface-1` (card) | `#231F2B` | 1.24 vs bg — visível sem borda |
| `--surface-2` (elevado/sheet) | `#322E39` | 1.51 vs bg |
| `--surface-sunken` (input) | `#060310` | 1.14 vs surface-1 |
| `--text` | `#F4F2F8` | **18.01** OK |
| `--text-muted` | `#AEADC3` | **9.11** OK |
| `--primary` | `#8342EB` | 3.76 vs bg (UI OK) · branco sobre ele **5.32** OK |
| `--primary-hover` | `#9459F0` | — |
| `--accent-text` | `#B688FF` | **7.58** OK |
| `--danger` | `#FF4A57` | **6.07** OK |
| `--success` | `#31EE64` | **12.90** OK |
| `--warning` | `#FF6333` | **6.75** OK |
| `--arcane` | `#EA78E2` | **7.89** OK |

### Light

| Token | Hex | Contraste medido |
|-------|-----|------------------|
| `--bg` | `#FAF8FC` | base |
| `--surface-1` | `#FFFFFF` + `--shadow-1` | 1.06 por cor -> **separação vem da sombra** |
| `--surface-sunken` (input) | `#EFEBF5` | 1.18 vs surface-1 |
| `--text` | `#14101F` | **17.71** OK |
| `--text-muted` | `#5B5670` | **6.61** OK |
| `--primary` | `#6E28D9` | **6.70** OK · branco sobre ele **7.07** OK |
| `--danger` | `#CF3C46` | ajustado de `#FF4A57` (falhava: 3.12) |
| `--success` | `#1B8337` | ajustado de `#31EE64` (falhava: 1.47) |
| `--warning` | `#C44C27` | ajustado de `#FF6333` (falhava: 2.81) |
| `--arcane` | `#A4549E` | ajustado de `#EA78E2` (falhava: 2.40) |

> Os 4 semânticos **têm par por tema**. Reusar o hex do dark em light reprova AA.

### Gradiente de destaque

```
linear-gradient(135deg, #5B1EBC 0%, #B688FF 55%, #FF6333 100%)
```

Permitido em: hero da vitrine, CTA primário, header da campanha ativa.
**Proibido** atrás de narrativa.

### Sombra

```
--shadow-1: 0 1px 2px rgba(11,6,19,.06), 0 6px 20px rgba(11,6,19,.08)
--shadow-2: 0 2px 4px rgba(11,6,19,.08), 0 16px 40px rgba(11,6,19,.14)
```

Em dark a sombra quase não lê — lá a separação é por luminância. Em light ela **é** a separação.

## 4. Tipografia

Três famílias, cada uma com um trabalho. Self-hosted via `@fontsource` — Google Fonts por
CDN quebra o PWA offline e atrapalha a CSP que vamos usar.

| Papel | Família | Uso |
|-------|---------|-----|
| Display + UI | **Archivo** (variable) | Títulos, botões, nav, labels |
| Narrativa | **IBM Plex Sans** | Texto do mestre, descrições, leitura longa |
| Dados | **IBM Plex Mono** | HP, atributos, rolagens, relógio do mundo (tabular) |

Pesos carregados: Archivo 500/700 · Plex Sans 400/600 · Plex Mono 400/500. Subset `latin`.

### Escala

| Token | Tamanho / linha | Tracking | Família |
|-------|-----------------|----------|---------|
| `display-lg` | 40 / 1.05 | -0.03em | Archivo 700 |
| `display` | 32 / 1.1 | -0.03em | Archivo 700 |
| `title` | 22 / 1.25 | -0.02em | Archivo 700 |
| `ui` | 15 / 1.4 | 0 | Archivo 500 |
| `ui-sm` | 13 / 1.4 | 0 | Archivo 500 |
| **`narrative`** | **17 / 1.75** | 0 | **Plex Sans 400** |
| `data` | 15 / 1.2 | 0 | Plex Mono 500, `tabular-nums` |

Coluna de narrativa: `max-width: 68ch`.

## 5. Forma e movimento

- Radius: `12` controles · `20` cards · `28` sheets · `999` pills
- Espaçamento: escala de 4 (4/8/12/16/24/32/48/64)
- Alvo de toque mínimo: 44px; botões de ação principais: **56px**
- Transições: 150ms (hover/estado), 200ms (entrada), `cubic-bezier(.2,.8,.2,1)`
- `prefers-reduced-motion`: transições vão a 0ms; nada de parallax

## 6. Componentes-chave

| Componente | Papel |
|------------|-------|
| `NarrativeStream` | Coluna de prosa contínua. Sem bolhas. Turnos separados por respiro |
| `TurnBlock` | Um turno. Seleção de texto livre + botão copiar (copia **markdown fonte**) |
| `ActionBar` | 3 pills — **Falar · Fazer · Continuar** — + input livre |
| `CharacterDrawer` | Ficha em sheet lateral/bottom, atualizada pelo `state_delta` |
| `SceneImageCard` | Imagem gerada da cena, inline no stream |
| `FloatingNav` | Ilha flutuante glass, bottom, safe-area. Item ativo = pill **sólido** |
| `WorldClock` | Relógio do mundo em Plex Mono |

### NarrativeStream — decisões técnicas

- **Sem virtualização por item.** Virtual list quebra seleção de texto que atravessa
  vários turnos, e "texto copiável" é requisito. Histórico longo resolve com
  paginação por sessão + "carregar anterior".
- Nunca `user-select: none` em conteúdo narrativo.
- Copiar entrega o **markdown fonte**, não o HTML renderizado.
- Markdown do LLM passa por `rehype-sanitize`. Saída de modelo é entrada não confiável.

### ActionBar — o botão Continuar

`turn_type` assume `speak`, `act` ou `continue`. Em `continue` o mestre avança tempo e age
pelos NPCs sem input do jogador.

Dois guard-rails, porque o botão é barato de apertar e a chamada não é:

1. Após **3** `continue` seguidos, a UI pede confirmação antes do próximo.
2. `time_passed_minutes` ganha teto por turno, senão o relógio do mundo dispara.

## 7. Acessibilidade — mínimo aceitável

- Todo texto >= 4.5:1 (medido, tabelas acima). Componentes de UI >= 3:1.
- `:focus-visible` sempre visível — exceção declarada à regra 1.
- Cor nunca é o único sinal: dano/cura também mudam ícone e rótulo.
- `NarrativeStream` é `aria-live="polite"`, para leitor de tela anunciar turno novo.
- Alvos >= 44px.
