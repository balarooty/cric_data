# CricInclusive Scraper

This workspace contains a Playwright-based scraper for CricInclusive fantasy match pages.

## Install

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npm run scrape -- "https://www.cricinclusive.com/fantasy-cricket/Royal-Challengers-Bengaluru-vs-Gujarat-Titans/dream11-prediction-player-stats/MTUyOTI3Ny0xNzc3MDM5MjAwMDAw"
```

You can optionally pass a second argument for a custom output directory:

```bash
node src/scrape-cricinclusive.js "<url>" ./output
```

## Output

For each page, the scraper writes a folder under `output/` containing:

- `page_snapshot.json`: full structured snapshot
- `page_snapshot.html`: rendered HTML after the page loads
- `page_text.txt`: flattened page text
- `royal_challengers_bengaluru_squad.{json,csv}`
- `gujarat_titans_squad.{json,csv}`
- `player_match_up.{json,csv}`
- `player_stats.{json,csv}`
- `player_last_match_current_selection.{json,csv}`
- `player_last_match_all_players.{json,csv}`

The scraper expands the "Player Last Match" dropdown and exports rows for every available player.
# cric_data
