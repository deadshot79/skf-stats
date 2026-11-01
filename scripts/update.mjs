// Revisa el historial público de Quake Club, se queda con las partidas del
// servidor de SkF y guarda en site/data/matches.json las que todavía no tenía.
//
// - Hace 1 consulta al historial por corrida.
// - Solo pide el detalle de las partidas NUEVAS (nunca repite una ya guardada).
// - Si Quake Club responde con límite de tasa (429), se detiene y reintenta
//   en la próxima corrida.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const BASE = (process.env.BASE_URL || "https://www.quakeclub.com").replace(/\/$/, "");
const FILTER = (process.env.SERVER_FILTER ?? "SkF").trim().toLowerCase();
const HISTORY_URL = process.env.HISTORY_URL || `${BASE}/api/matches/history`;
const DATA_FILE = process.env.DATA_FILE || "site/data/matches.json";
const MAX_NEW = Number(process.env.MAX_NEW_PER_RUN || 25);
const MAX_STORED = Number(process.env.MAX_STORED || 2500);
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 400);
const UA = "SkF-Clan-Stats/1.0 (+https://skfclan.com)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(15000),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* respuesta sin JSON */
    }
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: null, error: String(err) };
  }
}

async function loadStored() {
  try {
    const data = JSON.parse(await readFile(DATA_FILE, "utf8"));
    return Array.isArray(data.matches) ? data : { matches: [] };
  } catch {
    return { matches: [] };
  }
}

async function save(data) {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  // Una partida por línea: archivo compacto y fácil de revisar.
  const body =
    `{"updatedAt":${JSON.stringify(data.updatedAt)},"server":${JSON.stringify(data.server)},"matches":[\n` +
    data.matches.map((m) => JSON.stringify(m)).join(",\n") +
    `\n]}\n`;
  await writeFile(DATA_FILE, body);
}

// Pide el detalle probando los dos identificadores que trae el historial.
async function fetchDetail(item) {
  const ids = [...new Set([item.id, item.matchId].filter(Boolean))];
  for (const id of ids) {
    const r = await getJson(`${BASE}/api/matches/${encodeURIComponent(id)}`);
    if (r.status === 429) return { rateLimited: true };
    if (r.ok && r.json && r.json.success !== false && r.json.match && r.json.players) {
      return { detail: r.json };
    }
    await sleep(PAUSE_MS);
  }
  return {};
}

const round1 = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : null);
const num = (n) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

function normalize(detail, fallbackId) {
  const m = detail.match;
  const all = (detail.players && detail.players.all) || [];
  const players = all
    .filter((p) => p && p.steamId)
    .map((p) => {
      const weapons = {};
      for (const w of p.weapons || []) {
        if (num(w.shots) > 0 || num(w.kills) > 0) {
          weapons[w.weapon] = { hits: num(w.hits), shots: num(w.shots), kills: num(w.kills), damage: num(w.damage) };
        }
      }
      const medals = {};
      for (const [k, v] of Object.entries(p.medals || {})) {
        if (num(v) > 0) medals[k] = num(v);
      }
      return {
        steamId: String(p.steamId),
        name: p.playerName || "?",
        team: p.team,
        kills: num(p.kills),
        deaths: num(p.deaths),
        score: num(p.score),
        damageDealt: num(p.damageDealt),
        damageTaken: num(p.damageTaken),
        rounds: num(p.rounds),
        roundsWon: num(p.roundsWon),
        performance: round1(p.performance),
        eloChange: typeof p.eloChange === "number" ? p.eloChange : null,
        clan: p.clan && p.clan.tag ? p.clan.tag : null,
        weapons,
        medals,
      };
    });
  return {
    id: m.id || fallbackId,
    matchId: m.matchId || null,
    map: m.map || "?",
    gameType: String(m.gameType || "").toUpperCase(),
    playedAt: m.playedAt,
    duration: num(m.duration),
    serverName: m.serverName || "",
    team1Score: num(m.team1Score),
    team2Score: num(m.team2Score),
    rated: m.isRated !== false,
    players,
  };
}

async function main() {
  const stored = await loadStored();
  const known = new Set();
  for (const m of stored.matches) {
    if (m.id) known.add(m.id);
    if (m.matchId) known.add(m.matchId);
  }

  const hist = await getJson(HISTORY_URL);
  if (!hist.ok || !hist.json || !Array.isArray(hist.json.matches)) {
    console.warn(`No pude leer el historial (estado ${hist.status}). Se reintenta en la próxima corrida.`);
    return;
  }

  const inServer = hist.json.matches.filter(
    (m) => !FILTER || String(m.serverName || "").toLowerCase().includes(FILTER)
  );
  const fresh = inServer
    .filter((m) => !known.has(m.id) && !known.has(m.matchId))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    .slice(0, MAX_NEW);

  console.log(`Historial: ${hist.json.matches.length} partidas, ${inServer.length} del servidor, ${fresh.length} nuevas.`);

  const added = [];
  for (const item of fresh) {
    const r = await fetchDetail(item);
    if (r.rateLimited) {
      console.warn("Quake Club pidió bajar el ritmo (429). Corto aquí y sigo en la próxima corrida.");
      break;
    }
    if (!r.detail) {
      console.warn(`Sin detalle para ${item.id}. Se reintenta después.`);
      continue;
    }
    if (r.detail.match.isAborted) {
      // Partida abortada: se registra vacía para no pedirla otra vez.
      added.push({ id: item.id, matchId: item.matchId || null, map: item.map, gameType: item.gameType, playedAt: item.timestamp, duration: 0, serverName: item.serverName, team1Score: 0, team2Score: 0, rated: false, aborted: true, players: [] });
    } else {
      added.push(normalize(r.detail, item.id));
    }
    await sleep(PAUSE_MS);
  }

  if (added.length === 0) {
    console.log("Nada nuevo que guardar.");
    return;
  }

  const matches = [...added, ...stored.matches]
    .sort((a, b) => String(b.playedAt).localeCompare(String(a.playedAt)))
    .slice(0, MAX_STORED);

  await save({ updatedAt: new Date().toISOString(), server: FILTER || null, matches });
  console.log(`Guardadas ${added.length} partidas nuevas (total ${matches.length}).`);
}

main().catch((err) => {
  // Un fallo puntual no debe llenar de correos: se avisa en el registro y listo.
  console.warn("Error inesperado:", err);
});
