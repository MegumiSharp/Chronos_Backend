import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Come si ottiene un token. */
export const tokenAssignment = pgEnum("token_assignment", [
  "window", // riscatto dal sito entro una finestra temporale (eventualmente con codice)
  "subscriber", // assegnato automaticamente a tutti gli abbonati del canale (es. Default Token)
  "follower", // assegnato automaticamente a tutti i follower del canale
  "manual", // assegnato a mano da un admin (es. Supporto Ko-fi)
]);

/** Da dove arriva un token posseduto. */
export const tokenSource = pgEnum("token_source", [
  "window",
  "subscriber",
  "follower",
  "manual",
  "channel_points",
]);

/** Tipo di animazione in coda per l'overlay OBS. */
export const overlayEventKind = pgEnum("overlay_event_kind", ["token", "subscription"]);

export const subscriptionStatus = pgEnum("subscription_status", ["active", "ended"]);
export const subscriptionSource = pgEnum("subscription_source", ["eventsub", "reconcile"]);
/** pending = abbonato non ancora registrato su Chronos: il token arriva al primo login. */
export const redemptionStatus = pgEnum("redemption_status", ["pending", "granted", "refunded"]);
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    twitchId: text("twitch_id").notNull().unique(),
    login: text("login").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    /** Cache di COUNT(user_tokens) * XP_PER_TOKEN, aggiornata nella stessa transazione di ogni assegnazione. */
    xp: integer("xp").notNull().default(0),
    /** Spareggio in classifica: a parità di XP vince chi ci è arrivato prima. */
    levelReachedAt: ts("level_reached_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastLoginAt: ts("last_login_at").notNull().defaultNow(),
  },
  (t) => [index("users_leaderboard_idx").on(t.xp.desc(), t.levelReachedAt)],
);

/**
 * Stato abbonamento per id Twitch, alimentato da EventSub e dalla reconciliation giornaliera.
 * Volutamente senza FK verso users: chi si abbona prima di registrarsi viene collegato al login.
 */
export const subscriptions = pgTable("subscriptions", {
  twitchUserId: text("twitch_user_id").primaryKey(),
  twitchLogin: text("twitch_login"),
  /** "1000" (Tier 1 e Prime, che Twitch non distingue), "2000", "3000". */
  tier: text("tier").notNull(),
  isGift: boolean("is_gift").notNull().default(false),
  status: subscriptionStatus("status").notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
  source: subscriptionSource("source").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Tipi di evento (es. "Finale di stagione", "Live con gli amici"): nome univoco e colore matte.
 * Il token ne tiene una copia in event_label/event_color, aggiornata a ogni modifica del tipo,
 * così tutte le letture dei token restano una query sola.
 */
export const eventTypes = pgTable(
  "event_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    /** Come si ottengono i token di questo tipo: tooltip sul tag nel sito. */
    description: text("description"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("event_types_name_uq").on(sql`lower(${t.name})`)],
);

export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    /** Riga d'atmosfera mostrata sotto il nome del token, es. "L'ultima notte a bordo della Tulpar". */
    flavourText: text("flavour_text"),
    /** Token segreto: nell'archivio resta un punto interrogativo finché non lo si ottiene. */
    isSecret: boolean("is_secret").notNull().default(false),
    /** Autore dell'artwork, mostrato come pillola nel popup del token. */
    artistName: text("artist_name"),
    artistUrl: text("artist_url"),
    /** Indizio mostrato in archivio a chi non ha ancora sbloccato un token segreto. */
    secretHint: text("secret_hint"),
    /** Tipo di evento; event_label ed event_color ne sono la copia mostrata ovunque. */
    eventTypeId: uuid("event_type_id").references(() => eventTypes.id, { onDelete: "set null" }),
    /** Evento di riferimento mostrato nel catalogo, es. "Finale di MouthWashing". */
    eventLabel: text("event_label"),
    /** Colore matte del tipo di evento (#rrggbb): lo stesso evento si riconosce ovunque. */
    eventColor: text("event_color"),
    /** Copia della descrizione del tipo evento (tooltip). */
    eventDescription: text("event_description"),
    eventDate: ts("event_date"),
    /** Prefisso delle varianti WebP nello storage, es. "tokens/uncharted-3f9a". */
    artworkKey: text("artwork_key"),
    /** Colore predominante dell'artwork (#rrggbb), calcolato all'upload. */
    accentColor: text("accent_color"),
    /** Esperienza assegnata a chi ottiene il token (tipicamente 100-500). */
    xp: integer("xp").notNull().default(250),
    assignment: tokenAssignment("assignment").notNull().default("window"),
    redeemOpensAt: ts("redeem_opens_at"),
    redeemClosesAt: ts("redeem_closes_at"),
    /** Codice facoltativo annunciato in live, confrontato senza distinzione di maiuscole. */
    redeemCode: text("redeem_code"),
    /** Se true il token non compare nel catalogo finché la finestra non si apre. */
    hiddenUntilOpen: boolean("hidden_until_open").notNull().default(false),
    /** La finestra si chiude da sola 36 ore dopo l'apertura. */
    autoClose: boolean("auto_close").notNull().default(false),
    /** Escluso dal premio punti canale "token casuale" e dalla scelta dei premi. */
    excludeFromRandom: boolean("exclude_from_random").notNull().default(false),
    /** Se false, chi riceve la medaglia a mano non vede il tag "Assegnato dallo staff". */
    showManualTag: boolean("show_manual_tag").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "tokens_window_order",
      sql`${t.redeemOpensAt} is null or ${t.redeemClosesAt} is null or ${t.redeemClosesAt} > ${t.redeemOpensAt}`,
    ),
  ],
);

/**
 * Varianti grafiche di uno stesso token (max 5): chi lo possiede sceglie quale mostrare,
 * e la scelta è visibile a tutti. La posizione 0 è l'artwork principale del token.
 */
export const tokenVariants = pgTable(
  "token_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    label: text("label"),
    artworkKey: text("artwork_key"),
    accentColor: text("accent_color"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("token_variants_token_position_uq").on(t.tokenId, t.position),
    check("token_variants_position_range", sql`${t.position} between 1 and 5`),
  ],
);

export const userTokens = pgTable(
  "user_tokens",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    /** Variante scelta da questo utente; null = artwork principale. */
    variantId: uuid("variant_id").references(() => tokenVariants.id, { onDelete: "set null" }),
    source: tokenSource("source").notNull(),
    obtainedAt: ts("obtained_at").notNull().defaultNow(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    /** Null finché il popup "nuova medaglia" non è stato mostrato al proprietario. */
    seenAt: ts("seen_at"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.tokenId] }),
    index("user_tokens_token_idx").on(t.tokenId),
  ],
);

/** I token in evidenza (max 8): lo stesso set compare in Home e in classifica. */
export const equippedTokens = pgTable(
  "equipped_tokens",
  {
    userId: uuid("user_id").notNull(),
    slot: smallint("slot").notNull(),
    tokenId: uuid("token_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.slot] }),
    uniqueIndex("equipped_tokens_user_token_uq").on(t.userId, t.tokenId),
    // Si può equipaggiare solo un token posseduto; se viene revocato sparisce anche da qui.
    foreignKey({
      name: "equipped_tokens_owned_fk",
      columns: [t.userId, t.tokenId],
      foreignColumns: [userTokens.userId, userTokens.tokenId],
    }).onDelete("cascade"),
    check("equipped_tokens_slot_range", sql`${t.slot} between 1 and 8`),
  ],
);

/** Moderatori del canale (EventSub channel.moderator.add/remove + reconciliation). */
export const channelModerators = pgTable("channel_moderators", {
  twitchUserId: text("twitch_user_id").primaryKey(),
  twitchLogin: text("twitch_login"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Follower del canale (EventSub channel.follow + reconciliation): danno diritto ai token "follower". */
export const channelFollowers = pgTable("channel_followers", {
  twitchUserId: text("twitch_user_id").primaryKey(),
  twitchLogin: text("twitch_login"),
  followedAt: ts("followed_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Premi punti canale creati da Chronos su Twitch (max 5): ognuno sblocca un token o un token casuale. */
export const channelPointRewards = pgTable("channel_point_rewards", {
  id: uuid("id").primaryKey().defaultRandom(),
  twitchRewardId: text("twitch_reward_id").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  cost: integer("cost").notNull(),
  /** Token sbloccato; ignorato se isRandom. */
  tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
  isRandom: boolean("is_random").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Storico dei riscatti punti canale ricevuti via EventSub. */
export const channelPointRedemptions = pgTable(
  "channel_point_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    redemptionId: text("redemption_id").notNull().unique(),
    rewardId: uuid("reward_id").references(() => channelPointRewards.id, { onDelete: "set null" }),
    /** Id Twitch della ricompensa: serve per confermare o rimborsare anche se il premio è stato eliminato. */
    twitchRewardId: text("twitch_reward_id").notNull(),
    twitchUserId: text("twitch_user_id").notNull(),
    twitchLogin: text("twitch_login"),
    status: redemptionStatus("status").notNull(),
    tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: ts("created_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [index("channel_point_redemptions_user_idx").on(t.twitchUserId, t.status)],
);

/**
 * Coda per gli overlay OBS: un evento per ogni token riscattato (overlay principale)
 * e uno per ogni abbonamento (overlay sub). `kind` decide quale overlay lo riproduce.
 */
export const overlayEvents = pgTable("overlay_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: overlayEventKind("kind").notNull().default("token"),
  /** Nullo solo per gli eventi sub di chi non ha ancora nessun token da mostrare. */
  tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  /** Solo per kind = token. */
  source: tokenSource("source"),
  /** Solo per kind = subscription: mesi cumulativi e tier ("1000"/"2000"/"3000"/"prime"). */
  months: integer("months"),
  tier: text("tier"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Deduplica dei messaggi EventSub (Twitch può reinviare lo stesso messaggio). */
export const eventsubMessages = pgTable("eventsub_messages", {
  messageId: text("message_id").primaryKey(),
  subscriptionType: text("subscription_type").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
});

/** Admin aggiunti dal pannello; quelli in ADMIN_TWITCH_IDS sono sempre admin. */
export const admins = pgTable("admins", {
  twitchId: text("twitch_id").primaryKey(),
  twitchLogin: text("twitch_login"),
  addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Nome leggibile del bersaglio al momento dell'azione: resta anche se poi viene rinominato. */
    label: text("label"),
    /** Utente su cui ricade l'azione (assegnazioni, revoche, accessi): distinto da chi l'ha eseguita. */
    subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Dettagli: per le modifiche, `changes` con i campi toccati (prima/dopo). */
    data: jsonb("data"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt.desc()),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_actor_idx").on(t.actorUserId),
    index("audit_log_subject_idx").on(t.subjectUserId),
  ],
);

/** Token OAuth del broadcaster (cifrati), necessari per Helix e per le ricompense punti canale. */
export const broadcasterAuth = pgTable(
  "broadcaster_auth",
  {
    id: smallint("id").primaryKey().default(1),
    twitchId: text("twitch_id").notNull(),
    twitchLogin: text("twitch_login").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    scopes: text("scopes").array().notNull(),
    expiresAt: ts("expires_at").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("broadcaster_auth_singleton", sql`${t.id} = 1`)],
);

/**
 * Account Twitch secondario usato come bot in chat (es. ChronosBot): token cifrati, un solo account.
 * Separato da broadcaster_auth perché i permessi e l'account sono diversi.
 */
export const botAuth = pgTable(
  "bot_auth",
  {
    id: smallint("id").primaryKey().default(1),
    twitchId: text("twitch_id").notNull(),
    twitchLogin: text("twitch_login").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    scopes: text("scopes").array().notNull(),
    expiresAt: ts("expires_at").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("bot_auth_singleton", sql`${t.id} = 1`)],
);

/** Impostazioni chiave/valore (es. id della ricompensa punti canale). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Segnalazioni inviate dagli utenti dal sito. */
export const feedbackKind = pgEnum("feedback_kind", ["bug", "feedback", "suggestion", "copyright"]);
export const feedbackStatus = pgEnum("feedback_status", ["new", "in_progress", "resolved"]);

export const feedbackReports = pgTable(
  "feedback_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Autore, per poterlo ricontattare. Se l'utente viene eliminato la segnalazione resta, anonima. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: feedbackKind("kind").notNull(),
    message: text("message").notNull(),
    /** Solo per le segnalazioni copyright: medaglia o grafica interessata. */
    subject: text("subject"),
    /** Solo per le segnalazioni copyright: come ricontattare chi segnala (email, social, …). */
    contact: text("contact"),
    status: feedbackStatus("status").notNull().default("new"),
    /** Contesto tecnico raccolto in automatico: pagina (senza query string), browser, finestra, lingua. */
    pagePath: text("page_path"),
    userAgent: text("user_agent"),
    viewport: text("viewport"),
    locale: text("locale"),
    appVersion: text("app_version"),
    /** Chi ha cambiato lo stato per ultimo, dal pannello. */
    handledBy: uuid("handled_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("feedback_reports_created_idx").on(t.createdAt.desc()),
    index("feedback_reports_user_idx").on(t.userId, t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type EventType = typeof eventTypes.$inferSelect;
export type Token = typeof tokens.$inferSelect;
export type TokenVariant = typeof tokenVariants.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;
export type TokenAssignment = (typeof tokenAssignment.enumValues)[number];
export type TokenSource = (typeof tokenSource.enumValues)[number];
export type OverlayEventKind = (typeof overlayEventKind.enumValues)[number];
export type FeedbackKind = (typeof feedbackKind.enumValues)[number];
export type FeedbackStatus = (typeof feedbackStatus.enumValues)[number];
