import { db } from "@/db";
import { format } from "./i18n";
import { getSetting, setSetting, SETTING_KEYS } from "./settings";
import { sendChatMessage } from "./twitch/helix";

/**
 * Risposte in chat ai riscatti punti canale. I messaggi partono dall'account dello streamer
 * (Helix "Send Chat Message" con il suo token): serve lo scope user:write:chat.
 */
export type ChatBotMessage = "granted" | "completed" | "allOwned" | "alreadyOwned" | "notFollower";

export type ChatBotSettings = { enabled: boolean; messages: Record<ChatBotMessage, string> };

export const CHAT_BOT_MESSAGE_MAX = 400;

export const CHAT_BOT_MESSAGES: { key: ChatBotMessage; label: string; hint: string }[] = [
  { key: "granted", label: "Token riscattato", hint: "Il token è stato assegnato." },
  {
    key: "completed",
    label: "Ultimo token disponibile",
    hint: "Assegnato, e ora non ha più token da riscattare con il premio casuale.",
  },
  { key: "allOwned", label: "Ha già tutti i token", hint: "Premio casuale rimborsato: possiede già tutto." },
  { key: "alreadyOwned", label: "Token già posseduto", hint: "Premio di un token specifico che ha già: rimborsato." },
  { key: "notFollower", label: "Non follower", hint: "Rimborsato perché non segue il canale." },
];

export const DEFAULT_CHAT_BOT: ChatBotSettings = {
  enabled: false,
  messages: {
    granted: "@{user} hai riscattato il token {token}! Lo trovi nella tua collezione su Chronos.",
    completed: "@{user} hai riscattato {token}: era l'ultimo! Non ci sono altri token da riscattare per ora.",
    allOwned: "@{user} hai già tutti i token disponibili: i tuoi punti canale sono stati rimborsati.",
    alreadyOwned: "@{user} hai già il token {token}: i tuoi punti canale sono stati rimborsati.",
    notFollower: "@{user} per riscattare i token devi seguire il canale: i tuoi punti canale sono stati rimborsati.",
  },
};

export async function getChatBot(): Promise<ChatBotSettings> {
  const saved = await getSetting<Partial<ChatBotSettings>>(db, SETTING_KEYS.chatBot);
  return {
    enabled: Boolean(saved?.enabled),
    messages: { ...DEFAULT_CHAT_BOT.messages, ...saved?.messages },
  };
}

export async function saveChatBot(settings: ChatBotSettings): Promise<void> {
  await setSetting(db, SETTING_KEYS.chatBot, settings);
}

/**
 * Scrive in chat il messaggio previsto per l'esito. Non lancia mai: un errore della chat
 * non deve compromettere l'assegnazione o il rimborso, già conclusi.
 */
export async function notifyChat(
  message: ChatBotMessage,
  vars: { user: string; token?: string | null; reward?: string | null },
  { force = false }: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  try {
    const bot = await getChatBot();
    if (!bot.enabled && !force) return { ok: true };
    const template = bot.messages[message]?.trim();
    if (!template) return { ok: true };
    const text = format(template, { user: vars.user, token: vars.token ?? "", reward: vars.reward ?? "" });
    await sendChatMessage(text.slice(0, 500));
    return { ok: true };
  } catch (error) {
    console.error("[bot chat] messaggio non inviato", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
