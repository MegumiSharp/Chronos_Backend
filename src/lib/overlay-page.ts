import type { OverlayEventKind } from "@/db/schema";

/** Spessore del gettone in px: quanti strati di bordo vengono impilati lungo l'asse Z. */
const RIM_LAYERS = 40;
const RIM_STEP = 1;

/** Strati che formano il bordo del gettone, leggermente più stretti della faccia per restarci dietro. */
function rimLayers(): string {
  const half = ((RIM_LAYERS - 1) * RIM_STEP) / 2;
  return Array.from({ length: RIM_LAYERS }, (_, i) => {
    const z = (i * RIM_STEP - half).toFixed(2);
    return `<div class="rim" style="transform:translateZ(${z}px) scale(.955)"></div>`;
  }).join("");
}

export type OverlayPageOptions = {
  key: string;
  kind: OverlayEventKind;
  audioUrl: string | null;
  /** 0-100. */
  volume: number;
};

/**
 * Pagina HTML autonoma per la browser source di OBS: sfondo trasparente, nessun CSS del sito.
 * Interroga /api/overlay/<key>/events e anima un evento alla volta.
 *
 * Il gettone è costruito in 3D: due facce (fronte e retro speculare) separate da una pila di
 * dischi che, viste di taglio durante la rotazione, formano lo spessore del bordo.
 */
export function overlayPage({ key, kind, audioUrl, volume }: OverlayPageOptions): string {
  const isSub = kind === "subscription";

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chronos · overlay ${isSub ? "abbonamenti" : "token"}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;800&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  body { font-family: Sora, "Segoe UI", system-ui, sans-serif; color: #f2ede4; }
  .stage { position: fixed; inset: 0; display: grid; place-items: center; pointer-events: none; }
  .card { display: flex; flex-direction: column; align-items: center; gap: 28px; opacity: 0; }

  .coin-wrap { position: relative; width: 360px; height: 360px; perspective: 1600px; }
  .glow { position: absolute; inset: -45%; border-radius: 50%; opacity: 0;
    background: radial-gradient(circle, var(--accent) 0%, transparent 62%); }
  .rays { position: absolute; inset: -60%; border-radius: 50%; opacity: 0;
    background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--accent) 55%, transparent) 0deg 6deg, transparent 6deg 22deg);
    mask: radial-gradient(circle, #000 20%, transparent 68%); -webkit-mask: radial-gradient(circle, #000 20%, transparent 68%); }

  /* Corpo del gettone: tutto ciò che sta dentro vive nello stesso spazio 3D. */
  .coin { position: relative; width: 100%; height: 100%; transform-style: preserve-3d;
    filter: drop-shadow(0 20px 26px rgba(0,0,0,.6)); }
  .face { position: absolute; inset: 0; border-radius: 50%; backface-visibility: hidden;
    background: center / contain no-repeat; }
  .face.front { transform: translateZ(${(((RIM_LAYERS - 1) * RIM_STEP) / 2 + 0.6).toFixed(2)}px); }
  .face.back { transform: translateZ(-${(((RIM_LAYERS - 1) * RIM_STEP) / 2 + 0.6).toFixed(2)}px) rotateY(180deg); }
  /* Dischi impilati: visti di taglio diventano la fascia metallica del bordo, con luce e ombra. */
  .rim { position: absolute; inset: 0; border-radius: 50%;
    background: linear-gradient(100deg,
      color-mix(in srgb, var(--accent) 30%, #000) 0%,
      color-mix(in srgb, var(--accent) 70%, #000) 18%,
      color-mix(in srgb, var(--accent) 70%, #fff) 42%,
      #fff2 50%,
      color-mix(in srgb, var(--accent) 75%, #000) 68%,
      color-mix(in srgb, var(--accent) 25%, #000) 100%); }

  .text { text-align: center; opacity: 0; text-shadow: 0 3px 16px rgba(0,0,0,.85), 0 0 2px rgba(0,0,0,.9); }
  .who { font-size: 30px; font-weight: 600; }
  .name { font-size: 54px; font-weight: 800; line-height: 1.05; margin-top: 6px; }
  .tags { margin-top: 14px; display: flex; gap: 10px; justify-content: center; }
  .tag { padding: 7px 16px; border-radius: 999px; font-size: 20px; font-weight: 800; }
  .xp { background: rgba(232,176,75,.92); color: #1a1410; text-shadow: none; }
  .cp { background: rgba(123,63,242,.92); text-shadow: none; }
  .sub { background: rgba(145,70,255,.92); text-shadow: none; }
  .months { background: rgba(242,237,228,.92); color: #1a1410; text-shadow: none; }

  .play .card { animation: card 7s ease forwards; }
  .play .coin { animation: coin 7s cubic-bezier(.18,.9,.25,1) forwards; }
  .play .glow { animation: glow 7s ease forwards; }
  .play .rays { animation: rays 7s linear forwards; }
  .play .text { animation: text 7s ease forwards; }
  @keyframes card { 0% { opacity: 0 } 5% { opacity: 1 } 90% { opacity: 1 } 100% { opacity: 0 } }
  @keyframes coin {
    0%   { transform: translateY(140px) scale(.15) rotateY(0deg) }
    20%  { transform: translateY(0) scale(1.1) rotateY(1080deg) }
    28%  { transform: scale(1) rotateY(1080deg) }
    86%  { transform: scale(1) rotateY(1440deg) }
    100% { transform: translateY(-40px) scale(.7) rotateY(1440deg) }
  }
  @keyframes glow { 0% { opacity: 0; transform: scale(.3) } 22% { opacity: 1; transform: scale(1.15) } 40% { opacity: .7; transform: scale(1) } 88% { opacity: .7 } 100% { opacity: 0 } }
  @keyframes rays { 0%, 16% { opacity: 0; transform: rotate(0deg) } 30% { opacity: .9 } 88% { opacity: .6 } 100% { opacity: 0; transform: rotate(120deg) } }
  @keyframes text { 0%, 20% { opacity: 0; transform: translateY(24px) } 32% { opacity: 1; transform: none } 88% { opacity: 1 } 100% { opacity: 0 } }
  @media (prefers-reduced-motion: reduce) { .play .coin, .play .rays { animation: none } }
</style>
</head>
<body>
<div class="stage" id="stage"></div>
<script>
(() => {
  const API = "/api/overlay/" + ${JSON.stringify(key)} + "/events?kind=" + ${JSON.stringify(kind)};
  const AUDIO_URL = ${JSON.stringify(audioUrl)};
  const VOLUME = ${JSON.stringify(Math.min(Math.max(volume, 0), 100) / 100)};
  const IS_SUB = ${JSON.stringify(isSub)};
  const RIMS = ${JSON.stringify(rimLayers())};
  const DURATION = 7200;
  const stage = document.getElementById("stage");
  const queue = [];
  let lastId = null;
  let playing = false;

  // In OBS ricordarsi di spuntare "Controlla l'audio tramite OBS" nella fonte browser.
  const sound = AUDIO_URL ? new Audio(AUDIO_URL) : null;
  if (sound) { sound.volume = VOLUME; sound.preload = "auto"; }

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  async function poll() {
    try {
      const url = lastId === null ? API : API + "&after=" + lastId;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (lastId !== null) queue.push(...data.events);
        lastId = data.lastId;
        playNext();
      }
    } catch (_) {}
    setTimeout(poll, 2500);
  }

  function preload(src) {
    return new Promise((resolve) => {
      if (!src) return resolve();
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = src;
    });
  }

  function tierLabel(tier) {
    if (tier === "3000") return "Tier 3";
    if (tier === "2000") return "Tier 2";
    return "Tier 1";
  }

  function buildText(ev) {
    const text = el("div", "text");
    const tags = el("div", "tags");

    if (IS_SUB) {
      const months = Number(ev.months) || 1;
      const who = el("div", "who", ev.displayName);
      // Più mesi di abbonamento, più grande il nome: da 30px a 64px.
      who.style.fontSize = Math.min(30 + months * 2.8, 64).toFixed(0) + "px";
      who.style.fontWeight = months >= 12 ? "800" : "600";
      text.append(
        who,
        el("div", "name", months > 1 ? months + " mesi di abbonamento" : "si è abbonato al canale"),
      );
      tags.append(el("span", "tag sub", tierLabel(ev.tier)));
      if (ev.tokenName) tags.append(el("span", "tag months", ev.tokenName));
    } else {
      text.append(el("div", "who", ev.displayName + " ha ottenuto"), el("div", "name", ev.tokenName || "un token"));
      if (ev.xp) tags.append(el("span", "tag xp", "+" + ev.xp + " XP"));
      if (ev.viaChannelPoints) tags.append(el("span", "tag cp", "Reward Rupie"));
    }

    text.append(tags);
    return text;
  }

  async function playNext() {
    if (playing || queue.length === 0) return;
    playing = true;
    const ev = queue.shift();
    await preload(ev.image);

    const card = el("div", "card");
    card.style.setProperty("--accent", ev.accent);

    const wrap = el("div", "coin-wrap");
    const coin = el("div", "coin");
    coin.innerHTML = RIMS;
    const front = el("div", "face front");
    const back = el("div", "face back");
    if (ev.image) {
      const url = "url(" + JSON.stringify(ev.image) + ")";
      front.style.backgroundImage = url;
      back.style.backgroundImage = url;
    }
    coin.append(front, back);
    wrap.append(el("div", "rays"), el("div", "glow"), coin);

    card.append(wrap, buildText(ev));

    stage.replaceChildren(card);
    stage.classList.remove("play");
    void stage.offsetWidth;
    stage.classList.add("play");

    if (sound) {
      try { sound.currentTime = 0; sound.play().catch(() => {}); } catch (_) {}
    }

    setTimeout(() => {
      stage.classList.remove("play");
      stage.replaceChildren();
      playing = false;
      playNext();
    }, DURATION);
  }

  poll();
})();
</script>
</body>
</html>`;
}
