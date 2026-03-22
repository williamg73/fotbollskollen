# ⚽ Fotbollskollen — AI-driven fotbollsbevakning

En modern fotbollsnyhetsapp som hämtar och visar de senaste nyheterna via Claude AI med web search.

## 🚀 Kom igång

### Förkunskaper
- **Node.js** (v18+) — ladda ner från https://nodejs.org (LTS-versionen)

### Installation & start
```bash
# 1. Öppna terminalen i denna mapp
# 2. Installera beroenden
npm install

# 3. Starta utvecklingsservern
npm run dev

# 4. Öppna http://localhost:3000 i webbläsaren
```

## ✅ Funktioner

- 🔍 **Live nyheter** via Claude API med web search
- 🇸🇪 **Allt på svenska** — artiklar översätts automatiskt
- 📸 **Fotorealistiska bilder** från Pexels (fungerar lokalt)
- 🏟️ **Hero-bild** — stadion i bakgrunden
- 🔄 **Bakgrundsuppdatering** — nya nyheter hämtas var 5:e minut
- 📄 **Paginering** — 9 kort per sida, "Fler nyheter"-knapp
- 🔎 **Sök & filter** — liga, kategori, fritext
- 🌗 **Dark/Light mode**
- 🔖 **Bokmärken**

## 🏗️ Projektstruktur

```
fotbollskollen/
├── index.html          # HTML-ingång
├── package.json        # Beroenden
├── vite.config.js      # Vite-konfiguration
└── src/
    ├── main.jsx        # React-ingång
    └── App.jsx         # Hela appen (single-file)
```

## 📝 Anteckningar

- Appen använder Anthropic's Claude API med web search-verktyg
- Bilder laddas från Pexels (gratis, ingen API-nyckel krävs)
- Första laddningen tar 15-30 sekunder (API-anrop + web search)
- Efterföljande uppdateringar sker i bakgrunden
