import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ═══════════════════════════════════════════
//  FOTBOLLSKOLLEN — AI-Driven Football News
// ═══════════════════════════════════════════

// ── Constants ──
const LEAGUES = [
  { id: "all", label: "Alla ligor", emoji: "⚽" },
  { id: "premier-league", label: "Premier League", emoji: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "la-liga", label: "La Liga", emoji: "🇪🇸" },
  { id: "serie-a", label: "Serie A", emoji: "🇮🇹" },
  { id: "bundesliga", label: "Bundesliga", emoji: "🇩🇪" },
  { id: "ligue-1", label: "Ligue 1", emoji: "🇫🇷" },
  { id: "allsvenskan", label: "Allsvenskan", emoji: "🇸🇪" },
  { id: "other", label: "Övrigt", emoji: "🌍" },
];

const CATEGORIES = [
  { id: "all", label: "Alla", color: "#3b82f6" },
  { id: "transfer", label: "Transfers", color: "#10b981" },
  { id: "rumour", label: "Rykten", color: "#f59e0b" },
  { id: "match", label: "Matcher", color: "#8b5cf6" },
  { id: "injury", label: "Skador", color: "#ef4444" },
  { id: "manager", label: "Tränare", color: "#ec4899" },
  { id: "general", label: "Nyheter", color: "#6366f1" },
];

// ── Wikipedia image lookup (no API key needed, CORS enabled) ──
const wikiCache = new Map();

async function fetchWikipediaImage(query) {
  if (!query) return null;
  if (wikiCache.has(query)) return wikiCache.get(query);
  try {
    const slug = query.trim().replace(/\s+/g, "_");
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) { wikiCache.set(query, null); return null; }
    const data = await res.json();
    const url = data?.thumbnail?.source || data?.originalimage?.source || null;
    wikiCache.set(query, url);
    return url;
  } catch { wikiCache.set(query, null); return null; }
}

// ── Translation (unofficial Google Translate, no API key) ──
const translateCache = new Map();

async function translateToSwedish(text) {
  if (!text?.trim()) return text;
  if (translateCache.has(text)) return translateCache.get(text);
  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=sv&dt=t&q=${encodeURIComponent(text)}`,
      { signal: AbortSignal.timeout(7000) }
    );
    const data = await res.json();
    const translated = data[0]?.map(c => c?.[0] || "").join("") || text;
    translateCache.set(text, translated);
    return translated;
  } catch { return text; }
}

// ── TheSportsDB image lookup (free, football-specific) ──
const sportsdbCache = new Map();

async function fetchSportsDBImage(query, type = "team") {
  const key = `${type}:${query}`;
  if (sportsdbCache.has(key)) return sportsdbCache.get(key);
  try {
    const endpoint = type === "player"
      ? `https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${encodeURIComponent(query)}`
      : `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(query)}`;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const url = type === "player"
      ? (data?.player?.[0]?.strThumb || data?.player?.[0]?.strCutout || null)
      : (data?.teams?.[0]?.strTeamBadge || null);
    sportsdbCache.set(key, url);
    return url;
  } catch { sportsdbCache.set(key, null); return null; }
}

// Common club name normalizations for TheSportsDB queries
const CLUB_NORMALIZE = {
  "man city": "Manchester City", "man united": "Manchester United",
  "man utd": "Manchester United", "spurs": "Tottenham Hotspur",
  "psg": "Paris Saint-Germain", "atletico": "Atletico Madrid",
  "inter": "Inter Milan", "wolves": "Wolverhampton Wanderers",
  "newcastle": "Newcastle United", "leicester": "Leicester City",
  "west ham": "West Ham United", "aston villa": "Aston Villa",
};

function normalizeClubName(name) {
  return CLUB_NORMALIZE[name.toLowerCase()] || name;
}

// Image chain: RSS editorial → TheSportsDB → Wikipedia → instant Pexels fallback
async function fetchArticleImage(article) {
  // 1. Editorial image embedded directly in the RSS feed (most relevant)
  if (article.rssImage) return article.rssImage;

  // 2. TheSportsDB — football-only, guaranteed sport relevance
  const { category, entities } = article;
  const query = entities[0];
  if (query) {
    const personCentric = ["transfer", "manager", "injury"].includes(category);
    if (personCentric) {
      const playerImg = await fetchSportsDBImage(query, "player");
      if (playerImg) return playerImg;
    }
    const teamImg = await fetchSportsDBImage(normalizeClubName(query), "team");
    if (teamImg) return teamImg;
  }

  // 3. Wikipedia (only for multi-word entities to reduce wrong matches)
  if (query && query.split(" ").length >= 2) {
    const wikiImg = await fetchWikipediaImage(query);
    if (wikiImg) return wikiImg;
  }

  // 4. Instant football fallback — Pexels stadium/pitch/action, loads immediately
  return getInstantFallbackImage(article);
}

// Verified via Wikipedia REST API — these return beautiful stadium images:
// Camp Nou      → Camp_Nou_aerial.jpg        (iconic overhead aerial, vivid green pitch)
// Allianz Arena → Allianz_Arena_2008-02-09.jpg (illuminated stadium glowing at night)
// Tottenham     → London_Tottenham_Hotspur_Stadium.jpg (dramatic aerial interior)
const HERO_STADIUMS = ["Camp Nou", "Allianz Arena", "Tottenham Hotspur Stadium", "Wembley Stadium"];

// ── Soccer-guaranteed fallbacks via Pollinations.ai ──
// Only 8 unique prompts with fixed seeds → generated once, then permanently CDN-cached.
// All prompts explicitly say "soccer" / "football" to prevent non-soccer results.
const SOCCER_FALLBACK_URLS = [
  "soccer match action shot packed stadium crowd cheering, realistic sports photography, 4k, no text no watermark",
  "football player dribbling soccer ball on pitch stadium floodlights, realistic sports photography, 4k, no text",
  "soccer goalkeeper dramatic save goal mouth stadium, realistic sports photography, 4k, no text",
  "football players celebrating goal pitch crowded stadium, realistic sports photography, 4k, no text",
  "soccer night match aerial stadium view floodlights green pitch, realistic sports photography, 4k, no text",
  "football tackle midfield duel soccer players pitch crowd, realistic sports photography, 4k, no text",
  "soccer corner kick stadium atmosphere players wall, realistic sports photography, 4k, no text",
  "football training ground soccer players practice drills pitch, realistic sports photography, 4k, no text",
].map((prompt, i) =>
  `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=450&nologo=true&seed=${200 + i}`
);

function getInstantFallbackImage(article) {
  const hash = (article.title || article.id || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return SOCCER_FALLBACK_URLS[hash % SOCCER_FALLBACK_URLS.length];
}

// Pagination
const ARTICLES_PER_PAGE = 9;

const LEAGUE_COLORS = {
  "premier-league": ["#3d0030", "#6b1050", "#c026d3"],
  "la-liga": ["#1e1b4b", "#3730a3", "#818cf8"],
  "serie-a": ["#0c1929", "#1e3a5f", "#38bdf8"],
  "bundesliga": ["#450a0a", "#991b1b", "#fca5a5"],
  "ligue-1": ["#0a1e3d", "#1e40af", "#60a5fa"],
  "allsvenskan": ["#0c2340", "#1d4ed8", "#fbbf24"],
  "other": ["#1a1a2e", "#2d2d5e", "#a5b4fc"],
};

// ── Citation stripper ──
function stripCitations(text) {
  if (!text) return text;
  return text
    .replace(/<\/?(?:antml:)?cite[^>]*>/gi, "")
    .replace(/\[(?:\d+-\d+(?::\d+)?(?:,\s*)?)+\]/g, "")
    .replace(/\(\s*(?:cite|antml)[^)]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanArticle(a, i) {
  return {
    ...a,
    id: a.id || String(i + 1),
    title: stripCitations(a.title),
    description: stripCitations(a.description),
    content: stripCitations(a.content),
  };
}

// ── RSS Feeds ──
const RSS_FEEDS = [
  { url: "https://feeds.bbci.co.uk/sport/football/rss.xml",                 source: "BBC Sport",       icon: "🔴" },
  { url: "https://www.theguardian.com/football/rss",                        source: "The Guardian",    icon: "🟠" },
  { url: "https://www.skysports.com/rss/12040",                             source: "Sky Sports",      icon: "🔵" },
  { url: "https://www.espn.com/espn/rss/soccer/news",                       source: "ESPN FC",         icon: "⚡" },
  { url: "https://www.goal.com/feeds/en/news",                              source: "Goal.com",        icon: "⚽" },
  { url: "https://talksport.com/football/feed/",                            source: "talkSPORT",       icon: "📻" },
  { url: "https://www.90min.com/rss",                                       source: "90min",           icon: "🕐" },
  { url: "https://www.football365.com/feed",                                source: "Football365",     icon: "📋" },
  { url: "https://www.marca.com/en/football/rss/latest_news.xml",           source: "Marca",           icon: "🇪🇸" },
  { url: "https://www.football-italia.net/rss.xml",                         source: "Football Italia", icon: "🇮🇹" },
  { url: "https://www.kicker.de/news/fussball/bundesliga/rss.xml",          source: "Kicker",          icon: "🇩🇪" },
  { url: "https://www.lequipe.fr/rss/actu_rss_Football.xml",                source: "L'Équipe",        icon: "🇫🇷" },
  { url: "https://www.fourfourtwo.com/news/rss",                            source: "FourFourTwo",     icon: "📰" },
  { url: "https://sportbible.com/news.rss",                                 source: "SportBible",      icon: "📱" },
];

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}

function detectLeague(text) {
  const t = text.toLowerCase();
  if (/premier league|man united|man city|liverpool|chelsea|arsenal|tottenham|newcastle|aston villa|brighton|west ham/.test(t)) return "premier-league";
  if (/la liga|real madrid|barcelona|atletico|sevilla|valencia|athletic bilbao/.test(t)) return "la-liga";
  if (/serie a|juventus|inter milan|ac milan|napoli|roma|lazio|fiorentina/.test(t)) return "serie-a";
  if (/bundesliga|bayern|borussia dortmund|rb leipzig|bayer leverkusen|eintracht/.test(t)) return "bundesliga";
  if (/ligue 1|psg|paris saint-germain|monaco|lyon|marseille|lille/.test(t)) return "ligue-1";
  if (/allsvenskan|swedish|malmö|djurgården|ifk göteborg|hammarby|aik/.test(t)) return "allsvenskan";
  return "other";
}

function detectCategory(text) {
  const t = text.toLowerCase();
  if (/sign|transfer|fee|deal|joins|move|bid|bought|sold|contract extension/.test(t)) return "transfer";
  if (/rumour|rumor|linked|interest|target|considering|could|want|eyeing|tracking/.test(t)) return "rumour";
  if (/beats|wins|win|draw|loss|lose|score|goal|result|vs|match report|final/.test(t)) return "match";
  if (/injur|ruled out|out for|fitness|hamstring|knee|ankle|illness|doubt/.test(t)) return "injury";
  if (/manager|sacked|appointed|head coach|boss|resign|departure|leaves club/.test(t)) return "manager";
  return "general";
}

const SKIP_WORDS = new Set([
  "The","A","An","In","On","At","For","With","And","But","Or","After",
  "Before","As","That","This","His","Her","Its","By","From","To","Of",
  "Over","Into","About","How","Why","What","When","Where","Who","Will",
]);

function extractEntities(title) {
  const words = title.split(/\s+/);
  const entities = [];
  let i = 0;
  while (i < words.length) {
    const clean = words[i].replace(/[^a-zA-Z'-]/g, "");
    if (!SKIP_WORDS.has(words[i]) && /^[A-Z][a-z]{1,}/.test(clean)) {
      // Greedily collect consecutive capitalised words as one entity
      let entity = clean;
      let j = i + 1;
      while (j < words.length) {
        const next = words[j].replace(/[^a-zA-Z'-]/g, "");
        if (/^[A-Z]/.test(next) && !SKIP_WORDS.has(words[j])) {
          entity += " " + next;
          j++;
        } else break;
      }
      entities.push(entity);
      i = j;
    } else { i++; }
  }
  return [...new Set(entities)].slice(0, 4);
}

// Try multiple CORS proxies in order — corsproxy.io returns raw text, allorigins wraps in JSON
async function proxyFetch(url) {
  const attempts = [
    async () => {
      const r = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error(`corsproxy ${r.status}`);
      const t = await r.text();
      if (t.length < 200) throw new Error("too short");
      return t;
    },
    async () => {
      const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error(`allorigins ${r.status}`);
      const d = await r.json();
      if (!d.contents || d.contents.length < 200) throw new Error("empty");
      return d.contents;
    },
  ];
  for (const attempt of attempts) {
    try { return await attempt(); } catch {}
  }
  throw new Error("All proxies failed for " + url);
}

// Extract the editorial image embedded in an RSS item
function getRssItemImage(item) {
  const MEDIA_NS = "http://search.yahoo.com/mrss/";

  // media:content or media:thumbnail (BBC Sport, Guardian, Sky Sports, ESPN…)
  for (const tag of ["content", "thumbnail"]) {
    try {
      const el = item.getElementsByTagNameNS(MEDIA_NS, tag)[0];
      const url = el?.getAttribute("url");
      if (url?.startsWith("http")) return url;
    } catch {}
  }

  // <enclosure> (standard RSS image attachment)
  const enc = item.querySelector("enclosure");
  if (enc?.getAttribute("type")?.startsWith("image")) {
    const url = enc.getAttribute("url");
    if (url?.startsWith("http")) return url;
  }

  // Image URL inside the description HTML
  const rawDesc = item.querySelector("description")?.textContent || "";
  const m = rawDesc.match(/src=["']([^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)/i);
  if (m?.[1]?.startsWith("http")) return m[1];

  return null;
}

async function fetchRssFeed(feed) {
  const text = await proxyFetch(feed.url);

  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "text/xml");
  const items = xml.querySelectorAll("item");

  return Array.from(items).slice(0, 12).map((item, i) => {
    const title = stripHtml(item.querySelector("title")?.textContent || "");
    const rawDesc = item.querySelector("description")?.textContent || "";
    const description = stripHtml(rawDesc).slice(0, 300);
    const pubDate = item.querySelector("pubDate")?.textContent || "";
    const link = item.querySelector("link")?.textContent?.trim() || "";
    const guid = item.querySelector("guid")?.textContent || link || `${feed.source}-${i}`;
    const combined = title + " " + description;
    const rssImage = getRssItemImage(item);

    return {
      id: guid,
      title,
      description,
      content: description,
      source: feed.source,
      sourceIcon: feed.icon,
      league: detectLeague(combined),
      category: detectCategory(combined),
      entities: extractEntities(title),
      createdAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      isBreaking: false,
      link,
      rssImage,
    };
  });
}

// ── Semantic deduplication ──
const STOP_WORDS = new Set([
  "the","a","an","in","on","at","for","with","and","but","or","of","to","is",
  "are","was","were","has","have","had","be","been","will","would","could",
  "should","that","this","from","by","as","up","out","into","about","after",
  "over","s","it","he","she","they","his","her","their","its","new","says",
]);

function titleTokens(title) {
  return title.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter(w => sb.has(w)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

// Patterns for articles that should never be shown
const EXCLUDE_PATTERNS = [
  // Watch/stream guides
  /how\s+to\s+watch/i, /where\s+to\s+watch/i, /how\s+to\s+stream/i,
  /watch\s+.{0,30}free/i, /stream\s+.{0,30}free/i,
  /live\s+stream\s+free/i, /tv\s+channels?\s+and\s+stream/i,
  /best\s+vpn/i, /watch\s+online/i, /watch\s+for\s+free/i,
  /kick[\s-]?off\s+time.{0,20}tv/i,
  // Women's football
  /women'?s\s+(football|soccer|super\s+league|world\s+cup|champions\s+league|fa\s+cup)/i,
  /\bwsl\b/i, /\bnwsl\b/i, /women'?s\s+national\s+team/i,
  /girls?\s+(football|soccer|team)/i, /féminin(e|es)?\b/i,
];

function shouldExclude(article) {
  const text = `${article.title} ${article.description}`;
  return EXCLUDE_PATTERNS.some(p => p.test(text));
}

function deduplicateAndMerge(articles) {
  // Sort newest first so the freshest version wins each group
  articles.sort((a, b) => { try { return new Date(b.createdAt) - new Date(a.createdAt); } catch { return 0; } });

  const groups = [];
  for (const article of articles) {
    const tokens = titleTokens(article.title);
    let placed = false;
    for (const group of groups) {
      if (jaccard(tokens, titleTokens(group[0].title)) >= 0.35) {
        group.push(article);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([article]);
  }

  return groups.map(group => {
    if (group.length === 1) return group[0];
    // Pick the article with the longest description as the representative
    group.sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0));
    const best = { ...group[0] };
    const otherSources = [...new Set(group.slice(1).map(a => a.source).filter(Boolean))];
    if (otherSources.length > 0) {
      best.content = (best.content || best.description) +
        `\n\nÄven rapporterat av: ${otherSources.join(", ")}.`;
      best.extraSources = otherSources;
    }
    return best;
  });
}

// Phase 1 — fast: fetch RSS + deduplicate, no translation, no images
async function fetchRawArticles() {
  const results = await Promise.allSettled(RSS_FEEDS.map(fetchRssFeed));
  const articles = results.filter(r => r.status === "fulfilled").flatMap(r => r.value).filter(a => !shouldExclude(a));
  if (!articles.length) throw new Error("Kunde inte hämta nyheter från någon källa. Kontrollera din internetanslutning.");
  return deduplicateAndMerge(articles).map((a, i) => cleanArticle(a, i));
}

// Phase 2 — translate a single article to Swedish
async function translateArticle(a) {
  try {
    const [title, description] = await Promise.all([
      translateToSwedish(a.title),
      translateToSwedish(a.description),
    ]);
    const extra = a.extraSources?.length ? `\n\nÄven rapporterat av: ${a.extraSources.join(", ")}.` : "";
    return { ...a, title, description, content: description + extra };
  } catch { return a; }
}

// Phase 3 — pre-fetch image so background-refreshed articles arrive with image ready
async function preloadImage(a) {
  const url = await fetchArticleImage(a).catch(() => null);
  return { ...a, preloadedImage: url || getInstantFallbackImage(a) };
}

// ── Helpers ──
function timeAgo(d) {
  try {
    const ms = Date.now() - new Date(d).getTime();
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
    if (m < 2) return "Just nu"; if (m < 60) return `${m}m sedan`;
    if (h < 24) return `${h}h sedan`; if (dy < 7) return `${dy}d sedan`;
    return new Date(d).toLocaleDateString("sv-SE", { month: "short", day: "numeric" });
  } catch { return "Nyligen"; }
}
function getCatColor(c) { return CATEGORIES.find(s => s.id === c)?.color || "#3b82f6"; }
function getCatLabel(c) { return CATEGORIES.find(s => s.id === c)?.label || c; }
function getLeagueLabel(id) { return LEAGUES.find(l => l.id === id)?.label || id; }

// ══════════════════════════════════
//  CARD IMAGE — Wikipedia lookup
// ══════════════════════════════════
function CardImage({ article, large = false }) {
  const [imgUrl, setImgUrl] = useState(article.preloadedImage || null);
  const [loaded, setLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const fallbackColors = LEAGUE_COLORS[article.league] || LEAGUE_COLORS.other;

  useEffect(() => {
    // If image was pre-fetched (background refresh), use it immediately
    if (article.preloadedImage) { setImgUrl(article.preloadedImage); return; }
    let cancelled = false;
    setLoaded(false);
    setImgError(false);
    setImgUrl(null);
    fetchArticleImage(article)
      .then(url => { if (!cancelled) setImgUrl(url || getInstantFallbackImage(article)); })
      .catch(() => { if (!cancelled) setImgUrl(getInstantFallbackImage(article)); });
    return () => { cancelled = true; };
  }, [article.id, article.preloadedImage]);

  return (
    <div className={`cardImgWrap ${large ? "cardImgLg" : ""}`}>
      <div className="cardImgFallback" style={{
        background: `linear-gradient(135deg, ${fallbackColors[0]}, ${fallbackColors[1]}, ${fallbackColors[2]})`
      }} />

      {imgUrl && !imgError && (
        <img
          src={imgUrl}
          alt=""
          className={`cardImgReal ${loaded ? "cardImgLoaded" : ""}`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setImgError(true)}
        />
      )}

      <div className="imgCatBadge" style={{ background: getCatColor(article.category) }}>
        {getCatLabel(article.category).toUpperCase()}
      </div>

      <div className="imgGradBot" />
    </div>
  );
}

// ── Logo Component ──
function FotbollskollenLogo({ size = 36 }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className="logo">
      {/* Football / Soccer ball */}
      <circle cx="20" cy="20" r="18" fill="#10b981" stroke="#0d9488" strokeWidth="1.5" />
      {/* Pentagon pattern */}
      <path d="M20 6 L26 14 L24 22 L16 22 L14 14 Z" fill="#0f766e" opacity="0.6" />
      <path d="M26 14 L34 16 L32 26 L24 22 Z" fill="#0f766e" opacity="0.4" />
      <path d="M14 14 L6 16 L8 26 L16 22 Z" fill="#0f766e" opacity="0.4" />
      <path d="M24 22 L32 26 L28 34 L20 30 Z" fill="#0f766e" opacity="0.3" />
      <path d="M16 22 L8 26 L12 34 L20 30 Z" fill="#0f766e" opacity="0.3" />
      {/* Shine */}
      <ellipse cx="14" cy="12" rx="5" ry="4" fill="white" opacity="0.15" transform="rotate(-20, 14, 12)" />
    </svg>
  );
}

// ── Hero Image — Wikipedia REST API, tries stadiums in order until one has an image ──
function HeroImage() {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const tryNext = async (index) => {
      if (index >= HERO_STADIUMS.length || cancelled) return;
      try {
        const r = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(HERO_STADIUMS[index])}`,
          { signal: AbortSignal.timeout(6000) }
        );
        const d = await r.json();
        const img = d?.originalimage?.source || d?.thumbnail?.source;
        if (img && !cancelled) setUrl(img);
        else tryNext(index + 1);
      } catch { tryNext(index + 1); }
    };
    tryNext(0);
    return () => { cancelled = true; };
  }, []);

  return <div className="heroImg" style={{ backgroundImage: url ? `url(${url})` : "none" }} />;
}

// ── Article Card ──
function ArticleCard({ article, onClick, isBookmarked, onToggleBookmark }) {
  return (
    <article className={`card ${article.isBreaking ? "cardBrk" : ""}`} onClick={() => onClick(article)}>
      {article.isBreaking && (
        <div className="brkBadge"><span className="pDot" style={{ background: "#fff", width: 5, height: 5 }} /> BREAKING</div>
      )}
      <CardImage article={article} />
      <div className="cardBody">
        <div className="cardMeta">
          <span className="catTag" style={{ "--cc": getCatColor(article.category) }}>
            <span className="catDot" /> {getCatLabel(article.category)}
          </span>
          <span className="leagueTag">{getLeagueLabel(article.league)}</span>
        </div>
        <h3 className="cardTitle">{article.title}</h3>
        <p className="cardDesc">{article.description}</p>
        <div className="cardFoot">
          <div className="cardSrc"><span>{article.sourceIcon}</span> {article.source}</div>
          <div className="cardR">
            <span className="cardTime">{timeAgo(article.createdAt)}</span>
            <button className={`bkm ${isBookmarked ? "bkmOn" : ""}`}
              onClick={e => { e.stopPropagation(); onToggleBookmark(); }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

// ── Modal ──
function ArticleModal({ article, onClose, isBookmarked, onToggleBookmark }) {
  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="mOverlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mBox">
        <button className="mClose" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <CardImage article={article} large={true} />
        <div style={{ padding: "24px 28px 28px" }}>
          <div className="mMeta">
            <span className="catTag" style={{ "--cc": getCatColor(article.category), padding: "4px 12px", borderRadius: 100, background: `color-mix(in srgb, ${getCatColor(article.category)} 15%, transparent)` }}>
              <span className="catDot" /> {getCatLabel(article.category)}
            </span>
            {article.isBreaking && <span className="brkBadge" style={{ position: "static" }}><span className="pDot" style={{ background: "#fff", width: 5, height: 5 }} /> BREAKING</span>}
          </div>
          <h2 className="mTitle">{article.title}</h2>
          <div className="mInfo">
            <span style={{ fontWeight: 600 }}>{article.sourceIcon} {article.source}</span>
            <span>{getLeagueLabel(article.league)}</span>
            <span>{timeAgo(article.createdAt)}</span>
          </div>
          <div className="mContent">
            {(article.content || article.description).split("\n\n").map((p, i) => <p key={i}>{p}</p>)}
          </div>
          <div className="mTags">
            {article.entities?.map(e => <span key={e} className="tag">{e}</span>)}
          </div>
          <div className="mActions">
            <button className={`actBtn ${isBookmarked ? "actOn" : ""}`} onClick={onToggleBookmark}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              {isBookmarked ? "Sparad" : "Spara"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Loading / Error ──
function LoadingState() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const steps = ["Söker nyheter på webben...", "Översätter till svenska...", "Sammanställer artiklar..."];
  return (
    <div className="loadWrap">
      <div className="spinner" />
      <h3 style={{ marginTop: 24, fontSize: 17 }}>Hämtar senaste nyheterna...</h3>
      <p style={{ color: "var(--t3)", marginTop: 8, fontSize: 14 }}>
        {elapsed < 15 ? "Claude söker och sammanställer" : elapsed < 30 ? "Nästan klart..." : "Tar lite längre tid än vanligt..."} ({elapsed}s)
      </p>
      <div className="loadSteps">
        {steps.map((s, i) => <LoadingStep key={i} text={s} delay={i * 3000} />)}
      </div>
    </div>
  );
}

function LoadingStep({ text, delay }) {
  const [v, setV] = useState(false);
  useEffect(() => { const t = setTimeout(() => setV(true), delay); return () => clearTimeout(t); }, [delay]);
  if (!v) return null;
  return <div className="loadStep" style={{ animation: "fadeUp .4s ease both" }}><span className="pDot" style={{ background: "var(--ac)" }} /> {text}</div>;
}

function ErrorState({ error, onRetry }) {
  return (
    <div className="loadWrap">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#ef4444" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
      </svg>
      <h3 style={{ marginTop: 16, fontSize: 17 }}>Kunde inte ladda nyheter</h3>
      <p style={{ color: "var(--t3)", marginTop: 8, fontSize: 14, maxWidth: 400, textAlign: "center" }}>{error}</p>
      <button className="retryBtn" onClick={onRetry}>Försök igen</button>
    </div>
  );
}

// Pre-warm all 8 soccer fallback images so Pollinations caches them before articles arrive
SOCCER_FALLBACK_URLS.forEach(url => { const img = new Image(); img.src = url; });

// ════════════════
//  MAIN APP
// ════════════════
export default function App() {
  const [theme, setTheme] = useState("dark");
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [league, setLeague] = useState("all");
  const [category, setCategory] = useState("all");
  const [modal, setModal] = useState(null);
  const [bookmarks, setBookmarks] = useState(new Set());

  const toggleTheme = () => setTheme(t => {
    const n = t === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", n);
    return n;
  });

  const toggleBookmark = useCallback(id => {
    setBookmarks(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Merge new articles into existing ones — new on top, no duplicates
  const mergeArticles = useCallback((existing, incoming) => {
    const existingTitles = new Set(existing.map(a => a.title?.toLowerCase()));
    const brandNew = incoming.filter(a => !existingTitles.has(a.title?.toLowerCase()));
    const merged = [...brandNew, ...existing];
    // Sort newest first
    merged.sort((a, b) => {
      try { return new Date(b.createdAt) - new Date(a.createdAt); } catch { return 0; }
    });
    return merged;
  }, []);

  // Initial load — two-phase:
  // 1. Fetch + show articles immediately (original language, no images yet)
  // 2. Translate in batches of 6 in background, updating state as each batch completes
  const loadNews = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const raw = await fetchRawArticles();
      setArticles(raw);
      setLastUpdate(new Date());
      setLoading(false);

      // Translate in background — batches of 6 to avoid overwhelming the API
      const BATCH = 6;
      for (let i = 0; i < raw.length; i += BATCH) {
        const batch = raw.slice(i, i + BATCH);
        const translated = await Promise.all(batch.map(translateArticle));
        setArticles(prev => {
          const map = Object.fromEntries(translated.map(a => [a.id, a]));
          return prev.map(a => map[a.id] || a);
        });
      }
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }, []);

  // Background refresh — translates AND pre-fetches images so articles arrive complete
  const refreshInBackground = useCallback(async () => {
    if (loading || refreshing) return;
    setRefreshing(true);
    try {
      const raw = await fetchRawArticles();
      // Translate + preload images in parallel per article
      const prepared = await Promise.all(
        raw.map(a => translateArticle(a).then(t => preloadImage(t)))
      );
      setArticles(prev => mergeArticles(prev, prepared));
      setLastUpdate(new Date());
    } catch (e) {
      console.warn("Background refresh failed:", e.message);
    } finally { setRefreshing(false); }
  }, [loading, refreshing, mergeArticles]);

  // First load
  useEffect(() => { loadNews(); }, [loadNews]);

  // Auto-refresh every 5 minutes in background
  useEffect(() => {
    if (loading) return; // Don't start interval until first load is done
    const interval = setInterval(() => { refreshInBackground(); }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loading, refreshInBackground]);

  const filtered = useMemo(() => articles.filter(a => {
    const q = search.toLowerCase();
    const ms = !q || a.title?.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q) || a.entities?.some(e => e.toLowerCase().includes(q));
    return ms && (league === "all" || a.league === league) && (category === "all" || a.category === category);
  }), [articles, search, league, category]);

  const [visibleCount, setVisibleCount] = useState(ARTICLES_PER_PAGE);
  // Reset pagination when filters change
  useEffect(() => { setVisibleCount(ARTICLES_PER_PAGE); }, [search, league, category]);
  
  const visibleArticles = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const particles = useRef([...Array(20)].map(() => ({
    x: Math.random() * 100, y: Math.random() * 100,
    s: 2 + Math.random() * 4, d: 3 + Math.random() * 4, dl: Math.random() * 5,
  }))).current;

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        {/* ── Header ── */}
        <header className="hdr">
          <div className="hdrIn">
            <div className="hdrBrand">
              <FotbollskollenLogo />
              <span className="hdrName"><span className="hdrG">Fotbolls</span>kollen</span>
            </div>
            <nav className="hdrNav">
              <button className={`nl ${category === "all" ? "nlA" : ""}`} onClick={() => setCategory("all")}>Senaste</button>
              <button className={`nl ${category === "transfer" || category === "rumour" ? "nlA" : ""}`} onClick={() => setCategory(category === "transfer" ? "rumour" : "transfer")}>Transfers</button>
              <button className={`nl ${category === "match" ? "nlA" : ""}`} onClick={() => setCategory(category === "match" ? "all" : "match")}>Matcher</button>
            </nav>
            <div className="hdrAct">
              <div className="srcBox">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--t3)", flexShrink: 0 }}>
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input type="text" placeholder="Sök spelare, klubbar..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <button className="iconBtn" onClick={toggleTheme} title="Byt tema">
                {theme === "dark"
                  ? <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
                  : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                }
              </button>
              {!loading && (
                <button className={`iconBtn ${refreshing ? "iconSpin" : ""}`} onClick={refreshInBackground} title={refreshing ? "Uppdaterar..." : "Uppdatera nyheter"} disabled={refreshing}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ── Hero ── */}
        <section className="hero">
          <div className="heroBg">
            <HeroImage />
            <div className="heroOverlay" />
            <div className="heroPart">
              {particles.map((p, i) => (
                <div key={i} className="pt" style={{ left: `${p.x}%`, top: `${p.y}%`, "--s": `${p.s}px`, "--d": `${p.d}s`, "--dl": `${p.dl}s` }} />
              ))}
            </div>
          </div>
          <div className="heroCt">
            <div className="heroBdg"><span className="pDot" /> LIVE</div>
            <h1 className="heroT">
              <span className="heroTg">Fotbolls</span>
              <span className="heroTw">kollen</span>
            </h1>
            <p className="heroSub">Senaste fotbollsnyheterna — transfers, matcher, rykten och mer. Driven av AI.</p>
            <div className="heroSt">
              <div className="hSt"><span className="hStN">{articles.length}</span><span className="hStL">Nyheter</span></div>
              <div className="hStD" />
              <div className="hSt"><span className="hStN">{new Set(articles.map(a => a.category)).size}</span><span className="hStL">Kategorier</span></div>
              <div className="hStD" />
              <div className="hSt"><span className="hStN">{new Set(articles.map(a => a.league)).size}</span><span className="hStL">Ligor</span></div>
            </div>
          </div>
        </section>

        {/* ── Main ── */}
        <main className="mn">
          {refreshing && (
            <div className="refreshBar">
              <div className="refreshBarInner" />
            </div>
          )}
          <div className="fBar">
            <h2 className="fTitle">
              Nyhetsflöde <span className="fCnt">{filtered.length} artiklar</span>
              {lastUpdate && !loading && (
                <span className="fUpdated">Uppdaterad {lastUpdate.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</span>
              )}
              {refreshing && <span className="fRefreshing">Hämtar nya...</span>}
            </h2>
            <div className="fCtrl">
              <div className="fGrp">
                <label className="fLbl">Liga</label>
                <div className="chips">{LEAGUES.map(l => (
                  <button key={l.id} className={`chip ${league === l.id ? "chipOn" : ""}`} onClick={() => setLeague(l.id)}>
                    <span>{l.emoji}</span> {l.label}
                  </button>
                ))}</div>
              </div>
              <div className="fGrp">
                <label className="fLbl">Kategori</label>
                <div className="chips">{CATEGORIES.map(c => (
                  <button key={c.id} className={`chip ${category === c.id ? "chipOn" : ""}`} onClick={() => setCategory(c.id)}
                    style={category === c.id ? { borderColor: c.color, background: `color-mix(in srgb, ${c.color} 12%, transparent)`, color: c.color } : {}}>
                    {c.id !== "all" && <span className="chipDot" style={{ background: c.color }} />}
                    {c.label}
                  </button>
                ))}</div>
              </div>
            </div>
          </div>

          {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={loadNews} /> :
            filtered.length === 0 ? (
              <div className="empty">
                <svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="var(--t3)" strokeWidth="1.5"><circle cx="28" cy="28" r="20"/><line x1="42" y1="42" x2="56" y2="56"/></svg>
                <h3>Inga artiklar hittades</h3>
                <p>Prova att ändra sök eller filter</p>
              </div>
            ) : (
              <div className="grid">
                {visibleArticles.map((a, i) => (
                  <div key={a.id} className="gItem" style={{ "--stg": `${i * 0.06}s` }}>
                    <ArticleCard article={a} onClick={setModal} isBookmarked={bookmarks.has(a.id)} onToggleBookmark={() => toggleBookmark(a.id)} />
                  </div>
                ))}
              </div>
            )
          }
          {!loading && !error && hasMore && (
            <div className="loadMoreWrap">
              <button className="loadMoreBtn" onClick={() => setVisibleCount(v => v + ARTICLES_PER_PAGE)}>
                Fler nyheter
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <span className="loadMoreCount">Visar {visibleArticles.length} av {filtered.length}</span>
            </div>
          )}
        </main>

        {/* ── Footer ── */}
        <footer className="ft">
          <div className="ftIn">
            <div className="ftBrand"><FotbollskollenLogo size={28} /> <span className="ftName"><span className="hdrG">Fotbolls</span>kollen</span></div>
            <p style={{ fontSize: 13, color: "var(--t3)", marginTop: 8 }}>AI-driven fotbollsbevakning via Claude</p>
            <div className="ftBot">
              <p>© 2026 Fotbollskollen</p>
              <p style={{ color: "var(--ac)", fontWeight: 500 }}>Powered by Claude AI</p>
            </div>
          </div>
        </footer>

        {modal && <ArticleModal article={modal} onClose={() => setModal(null)} isBookmarked={bookmarks.has(modal.id)} onToggleBookmark={() => toggleBookmark(modal.id)} />}
      </div>
    </>
  );
}

// ══════════════
//  STYLES
// ══════════════
const styles = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Bricolage+Grotesque:wght@400;500;600;700;800&display=swap');

:root, [data-theme="dark"] {
  --bg: #060b14; --bg2: #0d1321; --bgc: #111927; --bgch: #162033; --bge: #1a2540;
  --t1: #f1f5f9; --t2: #94a3b8; --t3: #475569;
  --ac: #10b981; --acl: #34d399; --acd: #059669; --acg: rgba(16,185,129,0.12);
  --bd: rgba(255,255,255,0.06); --bdh: rgba(255,255,255,0.12); --bda: rgba(16,185,129,0.25);
  --shL: 0 12px 40px rgba(0,0,0,0.5); --shG: 0 0 30px rgba(16,185,129,0.08);
  --heroG: linear-gradient(145deg, #060b14 0%, #0a1628 35%, #0d2818 100%);
  --rs: 6px; --rm: 10px; --rl: 16px; --rx: 24px;
}
[data-theme="light"] {
  --bg: #f4f7f5; --bg2: #ffffff; --bgc: #ffffff; --bgch: #f0fdf4; --bge: #ecfdf5;
  --t1: #0f172a; --t2: #475569; --t3: #94a3b8;
  --ac: #059669; --acl: #10b981; --acd: #047857; --acg: rgba(5,150,105,0.08);
  --bd: rgba(0,0,0,0.07); --bdh: rgba(0,0,0,0.14); --bda: rgba(5,150,105,0.2);
  --shL: 0 12px 40px rgba(0,0,0,0.08); --shG: 0 0 30px rgba(5,150,105,0.05);
  --heroG: linear-gradient(145deg, #064e3b 0%, #065f46 40%, #047857 100%);
}

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth;-webkit-font-smoothing:antialiased}
body{font-family:'Outfit',system-ui,sans-serif;background:var(--bg);color:var(--t1);line-height:1.6;transition:background .3s,color .3s}
.app{min-height:100vh;display:flex;flex-direction:column}
.mn{max-width:1360px;margin:0 auto;padding:0 24px 80px;width:100%}

/* Header */
.hdr{position:sticky;top:0;z-index:100;background:var(--bg2);border-bottom:1px solid var(--bd);backdrop-filter:blur(20px)}
.hdrIn{max-width:1360px;margin:0 auto;padding:0 24px;height:64px;display:flex;align-items:center;justify-content:space-between;gap:20px}
.hdrBrand{display:flex;align-items:center;gap:10px}
.hdrName{font-family:'Bricolage Grotesque',sans-serif;font-size:20px;font-weight:800;letter-spacing:-.03em}
.hdrG{color:var(--acl)}
.hdrNav{display:flex;gap:4px}
.nl{padding:8px 14px;border-radius:var(--rs);color:var(--t2);background:none;border:none;font-family:inherit;font-size:14px;font-weight:500;cursor:pointer;transition:all .2s}
.nl:hover{color:var(--t1);background:var(--acg)}
.nlA{color:var(--acl);background:var(--acg)}
.hdrAct{display:flex;align-items:center;gap:8px}
.srcBox{display:flex;align-items:center;gap:8px;background:var(--bge);border:1px solid var(--bd);border-radius:var(--rs);padding:0 12px;transition:border-color .2s}
.srcBox:focus-within{border-color:var(--ac);box-shadow:0 0 0 3px var(--acg)}
.srcBox input{width:200px;padding:8px 0;border:none;outline:none;background:transparent;color:var(--t1);font-family:inherit;font-size:14px}
.srcBox input::placeholder{color:var(--t3)}
.iconBtn{width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:none;border:1px solid var(--bd);color:var(--t2);cursor:pointer;border-radius:var(--rs);transition:all .2s}
.iconBtn:hover{color:var(--acl);border-color:var(--bda);background:var(--acg)}
.iconBtn:disabled{opacity:0.5;cursor:default}
.iconSpin svg{animation:spin 1s linear infinite}

/* Refresh bar */
.refreshBar{position:relative;height:3px;background:var(--bd);border-radius:2px;margin-bottom:16px;overflow:hidden}
.refreshBarInner{position:absolute;top:0;left:0;height:100%;width:30%;background:var(--acl);border-radius:2px;animation:refreshSlide 1.2s ease-in-out infinite}
@keyframes refreshSlide{0%{left:-30%}100%{left:100%}}
.fUpdated{font-family:'Outfit',sans-serif;font-size:11px;color:var(--t3);font-weight:400;margin-left:8px}
.fRefreshing{font-family:'Outfit',sans-serif;font-size:11px;color:var(--acl);font-weight:500;margin-left:8px}

/* Hero */
.hero{position:relative;min-height:400px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:48px}
.heroBg{position:absolute;inset:0;background:#060b14}
.heroImg{position:absolute;inset:0;background-size:cover;background-position:center 30%;background-repeat:no-repeat}
.heroOverlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(6,11,20,0.25) 0%,rgba(6,11,20,0.55) 55%,rgba(6,11,20,0.92) 100%)}
.heroPart{position:absolute;inset:0;pointer-events:none;z-index:1}
.pt{position:absolute;width:var(--s);height:var(--s);background:var(--acl);border-radius:50%;opacity:0;animation:pf var(--d) var(--dl) ease-in-out infinite}
@keyframes pf{0%,100%{opacity:0;transform:translateY(0) scale(.5)}50%{opacity:.3;transform:translateY(-25px) scale(1)}}
.heroCt{position:relative;z-index:2;text-align:center;padding:50px 24px;max-width:680px}
.heroBdg{display:inline-flex;align-items:center;gap:8px;padding:5px 14px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.25);border-radius:100px;color:var(--acl);font-size:11px;font-weight:700;letter-spacing:.12em;margin-bottom:20px}
.pDot{width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block;flex-shrink:0;animation:pd 2s ease-in-out infinite}
@keyframes pd{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(16,185,129,0.4)}50%{box-shadow:0 0 0 6px rgba(16,185,129,0)}}
.heroT{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:clamp(42px,7vw,72px);line-height:1;letter-spacing:-.04em;margin-bottom:16px}
.heroTg{color:#f1f5f9}
.heroTw{color:var(--acl)}
.heroSub{font-size:16px;color:rgba(241,245,249,0.55);max-width:480px;margin:0 auto 28px;line-height:1.7}
.heroSt{display:flex;align-items:center;justify-content:center;gap:28px}
.hSt{text-align:center}
.hStN{display:block;font-size:26px;font-weight:800;color:#f1f5f9;font-family:'Bricolage Grotesque',sans-serif}
.hStL{font-size:11px;color:rgba(241,245,249,0.45);text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.hStD{width:1px;height:36px;background:rgba(255,255,255,0.08)}

/* Filters */
.fBar{margin-bottom:28px}
.fTitle{font-family:'Bricolage Grotesque',sans-serif;font-size:26px;font-weight:700;display:flex;align-items:baseline;gap:12px;margin-bottom:14px}
.fCnt{font-family:'Outfit',sans-serif;font-size:13px;color:var(--t3);font-weight:500}
.fCtrl{display:flex;flex-direction:column;gap:14px}
.fGrp{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.fLbl{font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;min-width:90px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;background:var(--bge);border:1px solid var(--bd);border-radius:100px;color:var(--t2);font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .2s;white-space:nowrap}
.chip:hover{border-color:var(--bdh);color:var(--t1)}
.chipOn{background:var(--acg);border-color:var(--bda);color:var(--acl)}
.chipDot{width:7px;height:7px;border-radius:50%;flex-shrink:0}

/* Grid */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:22px}
.gItem{animation:fu .5s cubic-bezier(.4,0,.2,1) both;animation-delay:var(--stg)}
@keyframes fu{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.empty{text-align:center;padding:80px 24px;color:var(--t3)}
.empty h3{margin-top:14px;font-size:17px;color:var(--t2)}
.empty p{margin-top:6px;font-size:14px}

/* Load More */
.loadMoreWrap{display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px 0 16px}
.loadMoreBtn{display:inline-flex;align-items:center;gap:8px;padding:14px 36px;background:var(--acg);border:1px solid var(--bda);border-radius:100px;color:var(--acl);font-family:inherit;font-size:15px;font-weight:600;cursor:pointer;transition:all .25s}
.loadMoreBtn:hover{background:var(--ac);color:#fff;border-color:var(--ac);transform:translateY(-2px);box-shadow:0 8px 24px rgba(16,185,129,0.2)}
.loadMoreCount{font-size:12px;color:var(--t3);font-weight:500}

/* Card */
.card{background:var(--bgc);border:1px solid var(--bd);border-radius:var(--rl);overflow:hidden;cursor:pointer;transition:all .3s cubic-bezier(.4,0,.2,1);position:relative}
.card:hover{transform:translateY(-4px);border-color:var(--bdh);box-shadow:var(--shL),var(--shG);background:var(--bgch)}
.cardBrk{border-color:rgba(239,68,68,0.3)}
.brkBadge{position:absolute;top:12px;left:12px;z-index:5;display:flex;align-items:center;gap:6px;padding:4px 10px;background:#ef4444;border-radius:100px;color:#fff;font-size:10px;font-weight:700;letter-spacing:.08em}
.cardImgWrap{position:relative;height:200px;overflow:hidden}
.cardImgLg{height:280px}
.cardImgFallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.cardImgReal{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .6s ease;z-index:1}
.cardImgLoaded{opacity:1}
.imgLoadingNotice{display:flex;flex-direction:column;align-items:center;gap:8px;color:rgba(255,255,255,0.55);font-size:11px;font-weight:500;letter-spacing:.02em}
.imgMiniSpinner{width:20px;height:20px;border:2px solid rgba(255,255,255,0.15);border-top-color:rgba(255,255,255,0.5);border-radius:50%;animation:spin .8s linear infinite}
.imgCatBadge{position:absolute;top:12px;left:12px;z-index:4;padding:4px 10px;border-radius:100px;color:#fff;font-size:10px;font-weight:700;letter-spacing:.06em}
.imgGradBot{position:absolute;bottom:0;left:0;right:0;height:50%;background:linear-gradient(to top,var(--bgc),transparent);pointer-events:none;z-index:2}
.cardBody{padding:18px 20px 20px}
.cardMeta{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.catTag{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--cc)}
.catDot{width:6px;height:6px;border-radius:50%;background:var(--cc)}
.leagueTag{font-size:11px;color:var(--t3);font-weight:500}
.cardTitle{font-family:'Bricolage Grotesque',sans-serif;font-size:19px;font-weight:700;line-height:1.3;margin-bottom:7px;letter-spacing:-.02em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cardDesc{font-size:14px;color:var(--t2);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:14px}
.cardFoot{display:flex;align-items:center;justify-content:space-between;padding-top:12px;border-top:1px solid var(--bd)}
.cardSrc{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t2);font-weight:500}
.cardR{display:flex;align-items:center;gap:10px}
.cardTime{font-size:12px;color:var(--t3)}
.bkm{background:none;border:none;color:var(--t3);cursor:pointer;padding:4px;border-radius:4px;transition:all .2s;display:flex}
.bkm:hover{color:var(--acl)}
.bkmOn{color:var(--ac)}

/* Modal */
.mOverlay{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;animation:fi .2s ease}
@keyframes fi{from{opacity:0}to{opacity:1}}
.mBox{background:var(--bg2);border:1px solid var(--bd);border-radius:var(--rx);max-width:700px;width:100%;max-height:88vh;overflow-y:auto;position:relative;animation:su .3s cubic-bezier(.4,0,.2,1);box-shadow:var(--shL)}
@keyframes su{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.mBox .cardImgWrap{height:280px;border-radius:0}
.mBox .imgGradBot{background:linear-gradient(to top,var(--bg2),transparent)}
.mClose{position:absolute;top:14px;right:14px;z-index:10;width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);border:none;border-radius:50%;color:rgba(255,255,255,0.8);cursor:pointer;transition:all .2s}
.mClose:hover{background:rgba(0,0,0,0.7);color:#fff}
.mMeta{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.mTitle{font-family:'Bricolage Grotesque',sans-serif;font-size:28px;font-weight:800;line-height:1.2;margin-bottom:10px;letter-spacing:-.03em}
.mInfo{display:flex;align-items:center;gap:14px;font-size:13px;color:var(--t2);margin-bottom:22px;flex-wrap:wrap}
.mContent p{font-size:15px;line-height:1.8;color:var(--t2);margin-bottom:14px}
.mContent p:first-child{font-size:16px;color:var(--t1);font-weight:500}
.mTags{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:20px}
.tag{padding:4px 11px;background:var(--acg);border:1px solid var(--bda);border-radius:100px;font-size:12px;color:var(--acl);font-weight:500}
.mActions{display:flex;gap:10px;padding-top:18px;border-top:1px solid var(--bd)}
.actBtn{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;background:var(--bge);border:1px solid var(--bd);border-radius:var(--rm);color:var(--t2);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s}
.actBtn:hover{border-color:var(--bdh);color:var(--t1)}
.actOn{color:var(--ac);border-color:var(--bda);background:var(--acg)}

/* Loading */
.loadWrap{padding:80px 24px;display:flex;flex-direction:column;align-items:center;text-align:center}
.spinner{width:44px;height:44px;border:3px solid var(--bd);border-top-color:var(--acl);border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.loadSteps{margin-top:20px;display:flex;flex-direction:column;gap:10px;text-align:left}
.loadStep{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--t2)}
.retryBtn{margin-top:18px;padding:10px 22px;background:var(--ac);border:none;border-radius:var(--rm);color:#fff;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .2s}
.retryBtn:hover{opacity:.9}

/* Footer */
.ft{background:var(--bg2);border-top:1px solid var(--bd);margin-top:auto}
.ftIn{max-width:1360px;margin:0 auto;padding:36px 24px 20px}
.ftBrand{display:flex;align-items:center;gap:10px}
.ftName{font-family:'Bricolage Grotesque',sans-serif;font-size:18px;font-weight:800;letter-spacing:-.02em}
.ftBot{display:flex;justify-content:space-between;align-items:center;padding-top:20px;margin-top:20px;border-top:1px solid var(--bd);font-size:13px;color:var(--t3)}

@media(max-width:768px){
  .hdrNav{display:none}.srcBox input{width:130px}.hero{min-height:320px}.heroCt{padding:36px 16px}
  .mn{padding:0 16px 60px}.fGrp{flex-direction:column;align-items:flex-start}.fLbl{min-width:auto}
  .grid{grid-template-columns:1fr;gap:16px}.mBox{border-radius:var(--rl)}
  .mTitle{font-size:22px}.ftBot{flex-direction:column;gap:6px;text-align:center}
}
@media(max-width:480px){
  .heroSt{flex-direction:column;gap:10px}.hStD{width:36px;height:1px}
  .chip{padding:5px 10px;font-size:12px}
}
`;
