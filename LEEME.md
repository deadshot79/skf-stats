# Tablero del Dragón · estadísticas de SkF

Página de estadísticas con datos reales del servidor de SkF. Cada 5 minutos un programa
revisa el historial público de Quake Club, guarda las partidas nuevas y actualiza la página.
Solo pide el detalle de partidas que todavía no tiene, así no sobrecarga a Quake Club.

## Cómo ponerlo en marcha (una sola vez)

1. En GitHub: **New repository** → nombre `skf-stats` → **Public** → **Create repository**.
2. En ese repositorio: **Settings → Pages → Source: GitHub Actions**.
3. Descomprime este paquete. En el repositorio: **Add file → Upload files** y arrastra
   **todo el contenido** de la carpeta (incluida la carpeta `.github`). Luego **Commit changes**.
4. Abre la pestaña **Actions**. Debe aparecer "Estadísticas SkF" corriendo y terminar en verde.
   Si quedó en rojo por Pages, entra a él y pulsa **Run workflow**.
5. La página queda en `https://TU-USUARIO.github.io/skf-stats/`.
   En skfclan.com: **Content → Navigation → Custom link** con esa dirección.

## Ajustes

Todo se cambia en `.github/workflows/stats.yml`:

- `SERVER_FILTER`: palabra que debe aparecer en el nombre del servidor en el historial
  (por defecto `SkF`).
- `HISTORY_URL`: cuando Forest agregue el filtro por servidor, pon aquí la dirección nueva.

## Cómo está armado

- `scripts/update.mjs`: busca partidas nuevas y las guarda en `site/data/matches.json`.
- `site/index.html`: la página (ranking, perfil por guerrero, partidas).
- Cada guerrero tiene enlace directo: `.../#jugador=STEAMID64`.
