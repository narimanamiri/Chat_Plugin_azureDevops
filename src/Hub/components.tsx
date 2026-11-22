/**
 * components.tsx - presentational pieces of the hub.
 *
 * Visual model follows Telegram Desktop: a conversation list with avatar,
 * preview line and timestamp; a message area of grouped bubbles aligned left
 * or right by author; a rounded composer with a circular send button.
 *
 * No component here touches storage directly; everything arrives through
 * props from Hub.tsx, which owns the ChatClient.
 *
 * Localisation comes through `LangContext` rather than props. Threading a
 * translator through eight component layers is noise, and every component
 * in this file needs it.
 *
 * Layout is written in CSS logical properties, so Persian mirrors the whole
 * interface by setting `dir="rtl"` on the document - there are no
 * direction conditionals in this tree. The exception is anything whose
 * meaning is physical rather than cultural: a message bubble's alignment
 * (mine on the inline-end side) is logical, but the little scroll-to-bottom
 * chevron points down in every language.
 */

import * as React from "react";

import type { Person } from "@core/client";
import type { DirectoryResult as DirectoryStatus } from "@core/devops";
import { memoiseResolver, segment, type ResolvedRef } from "@core/mentions";
import { resolveMention, navigateTo } from "@core/devops";
import { isImage } from "@core/files";
import {
  localeOf,
  translator,
  type Lang,
  type TranslateFn,
} from "@core/i18n";
import { REACTION_EMOJI } from "@core/model";
import type {
  AttachmentManifest,
  ConversationView,
  DecryptedMessage,
  Mention,
  SearchHit,
} from "@core/model";

const resolver = memoiseResolver(resolveMention);

/* ------------------------------------------------------------------ */
/* language                                                            */
/* ------------------------------------------------------------------ */

export interface LangValue {
  lang: Lang;
  t: TranslateFn;
}

export const LangContext = React.createContext<LangValue>({
  lang: "en",
  t: translator("en"),
});

const useLang = (): LangValue => React.useContext(LangContext);

/* ------------------------------------------------------------------ */
/* formatting                                                          */
/* ------------------------------------------------------------------ */

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** Stable colour per person, the way Telegram assigns avatar colours. */
function colourIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 7;
}

const formatBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const formatTime = (iso: string, lang: Lang): string =>
  new Date(iso).toLocaleTimeString(localeOf(lang), { hour: "2-digit", minute: "2-digit" });

const formatDay = (iso: string, lang: Lang, t: TranslateFn): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return lang === "fa" ? "امروز" : "Today";
  if (sameDay(date, yesterday)) return lang === "fa" ? "دیروز" : "Yesterday";
  void t;
  return date.toLocaleDateString(localeOf(lang), { day: "numeric", month: "long" });
};

/** Conversation list timestamps: time today, weekday this week, else a date. */
const formatListTime = (iso: string, lang: Lang): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(iso, lang);
  const days = (now.getTime() - date.getTime()) / 86400000;
  if (days < 7) return date.toLocaleDateString(localeOf(lang), { weekday: "short" });
  return date.toLocaleDateString(localeOf(lang), { day: "numeric", month: "numeric" });
};

/** "last seen" phrasing, coarse because the underlying data is coarse. */
const formatSeen = (iso: string, lang: Lang): string => {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.floor((Date.now() - at) / 60000);
  const rtf = new Intl.RelativeTimeFormat(localeOf(lang), { numeric: "auto" });
  if (minutes < 60) return rtf.format(-Math.max(1, minutes), "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.floor(hours / 24), "day");
};

/* ------------------------------------------------------------------ */
/* small pieces                                                        */
/* ------------------------------------------------------------------ */

export const Avatar: React.FC<{ name: string; seed?: string; small?: boolean; online?: boolean }> = ({
  name,
  seed,
  small,
  online,
}) => (
  <span className={`sc-avatar-wrap${small ? " sm" : ""}`}>
    <span
      className={`sc-avatar${small ? " sm" : ""} sc-avatar-c${colourIndex(seed ?? name)}`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
    {online && <span className="sc-online-dot" aria-hidden="true" />}
  </span>
);

const Icon: React.FC<{ path: string; size?: number }> = ({ path, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={path} />
  </svg>
);

const ICONS = {
  compose: "M20.7 3.3a2.4 2.4 0 0 0-3.4 0l-1 1 3.4 3.4 1-1a2.4 2.4 0 0 0 0-3.4zM3 17.2V21h3.8L18 9.8 14.2 6 3 17.2z",
  bell: "M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-5-5.9V4a1 1 0 1 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z",
  attach:
    "M16.5 6v11.5a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6H9v9.5a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v12.5a6 6 0 0 0 12 0V6h-1.5z",
  send: "M3 20.5 21 12 3 3.5 3 10l12 2-12 2z",
  trash: "M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  close: "M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z",
  reply: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  down: "M12 16.5 4.5 9l1.4-1.4L12 13.7l6.1-6.1L19.5 9z",
  search: "M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z",
  smile:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM12 17.5c2.3 0 4.3-1.4 5-3.5H7c.7 2.1 2.7 3.5 5 3.5z",
  people:
    "M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.7 0-8 1.3-8 4v2h9v-2c0-1.2.5-2.3 1.4-3.2A14 14 0 0 0 8 13zm8 0c-.6 0-1.3 0-2 .2 1.3.9 2 2 2 3.3V19h8v-2c0-2.7-5.3-4-8-4z",
  copy: "M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z",
  globe:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.3-3.4A8 8 0 0 1 18.9 8zM12 4c.7 1 1.3 2.3 1.7 4h-3.4C10.7 6.3 11.3 5 12 4zM4.3 14A8 8 0 0 1 4 12c0-.7.1-1.4.3-2h3.3a17 17 0 0 0 0 4H4.3zm.8 2h2.9c.3 1.2.8 2.4 1.3 3.4A8 8 0 0 1 5.1 16zm2.9-8H5.1a8 8 0 0 1 4.2-3.4A15.7 15.7 0 0 0 8 8zM12 20c-.7-1-1.3-2.3-1.7-4h3.4c-.4 1.7-1 3-1.7 4zm2.1-6H9.9a15 15 0 0 1 0-4h4.2a15 15 0 0 1 0 4zm.6 5.4c.5-1 1-2.2 1.3-3.4h2.9a8 8 0 0 1-4.2 3.4zM16.4 14a17 17 0 0 0 0-4h3.3c.2.6.3 1.3.3 2s-.1 1.4-.3 2h-3.3z",
};

export const Bell: React.FC<{ count: number; onClick?: () => void }> = ({ count, onClick }) => {
  const { t } = useLang();
  const label =
    count === 0 ? t("noUnread") : count === 1 ? t("unreadOne") : t("unreadMany", { n: count });
  return (
    <button className="sc-icon-btn" onClick={onClick} title={label} aria-label={label}>
      <Icon path={ICONS.bell} size={20} />
      {count > 0 && <span className="sc-badge">{count > 99 ? "99+" : count}</span>}
    </button>
  );
};

export const LanguageToggle: React.FC<{
  lang: Lang;
  onChange: (lang: Lang) => void;
}> = ({ lang, onChange }) => {
  const { t } = useLang();
  return (
    <button
      className="sc-icon-btn"
      title={t("language")}
      aria-label={t("language")}
      onClick={() => onChange(lang === "fa" ? "en" : "fa")}
    >
      <Icon path={ICONS.globe} size={19} />
      <span className="sc-lang-tag" aria-hidden="true">
        {lang === "fa" ? "FA" : "EN"}
      </span>
    </button>
  );
};

/* ------------------------------------------------------------------ */
/* conversation list                                                   */
/* ------------------------------------------------------------------ */

export const ConversationList: React.FC<{
  items: ConversationView[];
  selectedId?: string;
  myUserId: string;
  nameOf: (userId: string) => string;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onNewDirect: () => void;
  onNewChannel: () => void;
  children?: React.ReactNode;
}> = ({
  items,
  selectedId,
  myUserId,
  nameOf,
  query,
  onQuery,
  onSelect,
  onNewDirect,
  onNewChannel,
  children,
}) => {
  const { lang, t } = useLang();
  return (
    <nav className="sc-sidebar" aria-label={t("appTitle")}>
      <div className="sc-sidebar-head">
        <span className="sc-sidebar-title">{t("appTitle")}</span>
        <button className="sc-icon-btn" onClick={onNewChannel} title={t("newChannel")} aria-label={t("newChannel")}>
          <span aria-hidden="true" className="sc-hash">
            #
          </span>
        </button>
        <button className="sc-icon-btn" onClick={onNewDirect} title={t("newMessage")} aria-label={t("newMessage")}>
          <Icon path={ICONS.compose} size={19} />
        </button>
      </div>

      <div className="sc-search">
        <Icon path={ICONS.search} size={16} />
        <input
          type="search"
          value={query}
          placeholder={t("searchPlaceholder")}
          aria-label={t("search")}
          onChange={(e) => onQuery(e.target.value)}
        />
        {query && (
          <button className="sc-icon-btn" onClick={() => onQuery("")} title={t("clearSearch")} aria-label={t("clearSearch")}>
            <Icon path={ICONS.close} size={14} />
          </button>
        )}
      </div>

      <div className="sc-conv-scroll">
        {children ?? (
          <>
            {items.length === 0 && <div className="sc-empty">{t("noConversations")}</div>}
            {items.map((item) => {
              const preview = item.lastPreview
                ? item.kind === "dm"
                  ? item.lastPreview
                  : `${item.lastSenderId ? `${nameOf(item.lastSenderId)}: ` : ""}${item.lastPreview}`
                : t("noMessagesYet");
              const mine = item.lastSenderId === myUserId;
              return (
                <button
                  key={item.id}
                  className={`sc-conv${item.id === selectedId ? " selected" : ""}${
                    item.unread ? " unread" : ""
                  }`}
                  onClick={() => onSelect(item.id)}
                >
                  <Avatar name={item.title} seed={item.id} />
                  <span className="sc-conv-body">
                    <span className="sc-conv-row">
                      <span className="sc-conv-title">{item.title}</span>
                      <span className="sc-conv-time">{formatListTime(item.lastActivityAt, lang)}</span>
                    </span>
                    <span className="sc-conv-row">
                      <span className="sc-conv-preview">
                        {mine && item.lastPreview ? t("you") : ""}
                        {preview}
                      </span>
                      {item.unread > 0 && (
                        <span className="sc-pill">{item.unread > 99 ? "99+" : item.unread}</span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </nav>
  );
};

/* ------------------------------------------------------------------ */
/* search results                                                      */
/* ------------------------------------------------------------------ */

export const SearchResults: React.FC<{
  hits: SearchHit[];
  busy: boolean;
  truncated: boolean;
  query: string;
  onOpen: (hit: SearchHit) => void;
}> = ({ hits, busy, truncated, query, onOpen }) => {
  const { lang, t } = useLang();

  if (query.trim().length < 2) return <div className="sc-empty">{t("searchHint")}</div>;
  if (busy && hits.length === 0) return <div className="sc-empty">{t("loading")}</div>;
  if (hits.length === 0) return <div className="sc-empty">{t("searchNoResults")}</div>;

  return (
    <>
      <div className="sc-search-count">{t("searchResults", { n: hits.length })}</div>
      {hits.map((hit) => (
        <button
          key={`${hit.convId}-${hit.message.id}`}
          className="sc-conv sc-hit"
          onClick={() => onOpen(hit)}
        >
          <Avatar name={hit.convTitle} seed={hit.convId} />
          <span className="sc-conv-body">
            <span className="sc-conv-row">
              <span className="sc-conv-title">{hit.convTitle}</span>
              <span className="sc-conv-time">{formatListTime(hit.message.sentAt, lang)}</span>
            </span>
            <span className="sc-conv-row">
              <span className="sc-conv-preview">
                {hit.message.senderName}: {highlight(hit.message.body.text, query)}
              </span>
            </span>
          </span>
        </button>
      ))}
      {truncated && <div className="sc-hint sc-search-note">{t("searchTruncated")}</div>}
    </>
  );
};

/** Wrap matches in <mark>. Case-insensitive, literal - not a regex from input. */
function highlight(text: string, query: string): React.ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;
  const out: React.ReactNode[] = [];
  let from = 0;
  const lowered = text.toLowerCase();
  for (;;) {
    const at = lowered.indexOf(needle, from);
    if (at < 0) break;
    if (at > from) out.push(text.slice(from, at));
    out.push(
      <mark key={at} className="sc-mark">
        {text.slice(at, at + needle.length)}
      </mark>
    );
    from = at + needle.length;
  }
  out.push(text.slice(from));
  return out;
}

/* ------------------------------------------------------------------ */
/* mentions                                                            */
/* ------------------------------------------------------------------ */

const KIND_SIGIL: Record<Mention["kind"], string> = {
  workitem: "#",
  pullrequest: "!",
  commit: "◆",
  user: "@",
  build: "▶",
  url: "\u{1F517}",
};

const MentionChip: React.FC<{ mention: Mention }> = ({ mention }) => {
  const [ref, setRef] = React.useState<ResolvedRef | undefined>(
    mention.label ? { label: mention.label } : undefined
  );

  React.useEffect(() => {
    let alive = true;
    void resolver(mention).then((r) => {
      if (alive && r) setRef(r);
    });
    return () => {
      alive = false;
    };
  }, [mention.kind, mention.value]);

  const label = ref?.label ?? mention.raw;
  const short = mention.kind === "commit" ? mention.value.slice(0, 8) : mention.value;

  return (
    <a
      className="sc-chip"
      href={ref?.url ?? "#"}
      title={ref?.sublabel ? `${ref.sublabel} · ${label}` : label}
      onClick={(e) => {
        e.preventDefault();
        if (ref?.url) void navigateTo(ref.url);
      }}
    >
      {/* Latin identifiers inside Persian text need an isolate, or the
          bidi algorithm reorders "#1234" against the surrounding run. */}
      <span className="sc-chip-kind" dir="ltr">
        {KIND_SIGIL[mention.kind]}
        {mention.kind === "user" ? "" : short}
      </span>
      <span>{mention.kind === "url" ? "link" : label}</span>
    </a>
  );
};

/* ------------------------------------------------------------------ */
/* messages                                                            */
/* ------------------------------------------------------------------ */

const Attachment: React.FC<{
  attachment: AttachmentManifest;
  imageUrl?: (a: AttachmentManifest) => Promise<string>;
  onDownload: (a: AttachmentManifest) => Promise<void>;
}> = ({ attachment, imageUrl, onDownload }) => {
  const { t } = useLang();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [src, setSrc] = React.useState<string>();

  const image = isImage(attachment.mime);

  React.useEffect(() => {
    if (!image || !imageUrl) return;
    let alive = true;
    void imageUrl(attachment)
      .then((url) => alive && setSrc(url))
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [image, attachment.blobId]);

  if (image) {
    // Reserve the final size up front so the list does not jump while the
    // image decodes, capped so a screenshot cannot fill the whole column.
    const w = attachment.width ?? 480;
    const h = attachment.height ?? 320;
    const scale = Math.min(1, 380 / w, 320 / h);
    return (
      <figure
        className="sc-image"
        style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}
        title={attachment.name + " - " + formatBytes(attachment.size)}
      >
        {src ? (
          <img src={src} alt={attachment.name} onClick={() => void onDownload(attachment)} />
        ) : (
          <span className="sc-image-loading">{error ?? t("loading")}</span>
        )}
      </figure>
    );
  }

  return (
    <button
      className="sc-attachment"
      disabled={busy}
      title={attachment.name}
      onClick={async () => {
        setBusy(true);
        setError(undefined);
        try {
          await onDownload(attachment);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="sc-attachment-icon">
        <Icon path={ICONS.attach} size={18} />
      </span>
      <span className="sc-attachment-meta">
        <span className="sc-attachment-name">{attachment.name}</span>
        <span className="sc-attachment-size" dir="ltr">
          {busy ? t("loading") : error ?? formatBytes(attachment.size)}
        </span>
      </span>
    </button>
  );
};

/** Group runs of consecutive messages from one author, as Telegram does. */
interface Grouped {
  message: DecryptedMessage;
  firstOfGroup: boolean;
  lastOfGroup: boolean;
  dayLabel?: string;
}

function group(messages: DecryptedMessage[], lang: Lang, t: TranslateFn): Grouped[] {
  const out: Grouped[] = [];
  let lastDay = "";
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const previous = messages[i - 1];
    const next = messages[i + 1];
    const day = formatDay(message.sentAt, lang, t);

    // A gap of more than 5 minutes starts a new visual group even for the
    // same author, which is what keeps a long conversation readable.
    const withinWindow = (a?: DecryptedMessage, b?: DecryptedMessage) =>
      !!a &&
      !!b &&
      a.senderId === b.senderId &&
      Math.abs(new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()) < 5 * 60 * 1000;

    const sameDayAsPrevious = previous && formatDay(previous.sentAt, lang, t) === day;
    out.push({
      message,
      dayLabel: day === lastDay ? undefined : day,
      firstOfGroup: !withinWindow(previous, message) || !sameDayAsPrevious,
      // `next` missing means this is the newest message, which always ends
      // its group. Spelled out rather than relying on an invalid date
      // comparing unequal to everything.
      lastOfGroup: !next || !withinWindow(message, next) || formatDay(next.sentAt, lang, t) !== day,
    });
    lastDay = day;
  }
  return out;
}

const Reactions: React.FC<{
  reactions: Record<string, string[]>;
  myUserId: string;
  nameOf: (userId: string) => string;
  onToggle: (emoji: string) => void;
}> = ({ reactions, myUserId, nameOf, onToggle }) => {
  const entries = Object.entries(reactions).filter(([, users]) => users.length > 0);
  if (entries.length === 0) return null;
  return (
    <div className="sc-reactions">
      {entries.map(([emoji, users]) => (
        <button
          key={emoji}
          className={`sc-reaction${users.includes(myUserId) ? " mine" : ""}`}
          title={users.map(nameOf).join(", ")}
          onClick={() => onToggle(emoji)}
        >
          <span aria-hidden="true">{emoji}</span>
          <span className="sc-reaction-count">{users.length}</span>
        </button>
      ))}
    </div>
  );
};

const ReactionPicker: React.FC<{ onPick: (emoji: string) => void; onClose: () => void }> = ({
  onPick,
  onClose,
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    ref.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div className="sc-reaction-picker" ref={ref} role="menu">
      {REACTION_EMOJI.map((emoji) => (
        <button key={emoji} role="menuitem" onClick={() => onPick(emoji)} aria-label={emoji}>
          {emoji}
        </button>
      ))}
    </div>
  );
};

export const TypingLine: React.FC<{ names: string[] }> = ({ names }) => {
  const { t } = useLang();
  if (names.length === 0) return null;
  const label =
    names.length === 1
      ? t("typing", { name: names[0] })
      : names.length === 2
        ? t("typingTwo", { name: names[0], other: names[1] })
        : t("typingMany", { n: names.length });
  return (
    <div className="sc-typing" aria-live="polite">
      <span className="sc-typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {label}
    </div>
  );
};

export const MessageList: React.FC<{
  messages: DecryptedMessage[];
  myUserId: string;
  showAuthors: boolean;
  nameOf: (userId: string) => string;
  /** How many messages were unread when the conversation was opened. */
  unreadOnOpen: number;
  hasOlder: boolean;
  loadingOlder: boolean;
  typing: string[];
  /** Message to flash after jumping to it from search. */
  highlightId?: string;
  onLoadOlder: () => void;
  imageUrl?: (a: AttachmentManifest) => Promise<string>;
  onDownload: (a: AttachmentManifest) => Promise<void>;
  onDelete: (m: DecryptedMessage) => void;
  onReply: (m: DecryptedMessage) => void;
  onEdit: (m: DecryptedMessage) => void;
  onReact: (m: DecryptedMessage, emoji: string) => void;
}> = ({
  messages,
  myUserId,
  showAuthors,
  nameOf,
  unreadOnOpen,
  hasOlder,
  loadingOlder,
  typing,
  highlightId,
  onLoadOlder,
  imageUrl,
  onDownload,
  onDelete,
  onReply,
  onEdit,
  onReact,
}) => {
  const { lang, t } = useLang();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = React.useState(true);
  const [picking, setPicking] = React.useState<string>();
  const previousCount = React.useRef(messages.length);
  const heightBeforePrepend = React.useRef(0);
  const atBottomRef = React.useRef(true);

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    // Only call setState when the answer changed. A scroll event fires per
    // frame; re-rendering the whole list on each one made dragging the
    // scrollbar visibly stutter.
    if (bottom !== atBottomRef.current) {
      atBottomRef.current = bottom;
      setAtBottom(bottom);
    }
    // Reaching the top pulls in the previous page, as every chat client does.
    if (el.scrollTop < 60 && hasOlder && !loadingOlder) {
      heightBeforePrepend.current = el.scrollHeight;
      onLoadOlder();
    }
  }, [hasOlder, loadingOlder, onLoadOlder]);

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length - previousCount.current;
    previousCount.current = messages.length;

    // Older messages were prepended: hold the reader's position rather than
    // throwing them somewhere else in the history.
    if (heightBeforePrepend.current && el.scrollHeight > heightBeforePrepend.current) {
      el.scrollTop += el.scrollHeight - heightBeforePrepend.current;
      heightBeforePrepend.current = 0;
      return;
    }
    // New messages arrived: only follow them if the reader was already at the
    // end. Scrolling somebody away from what they are reading is hostile.
    if (grew > 0 && atBottomRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Arriving from a search result: bring that message into view.
  React.useLayoutEffect(() => {
    if (!highlightId) return;
    const node = scrollRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(highlightId)}"]`
    );
    node?.scrollIntoView({ block: "center" });
  }, [highlightId, messages]);

  if (messages.length === 0) {
    return (
      <div className="sc-messages-wrap">
        <div className="sc-messages" ref={scrollRef} onScroll={onScroll}>
          {hasOlder && (
            <button className="sc-load-older" onClick={onLoadOlder} disabled={loadingOlder}>
              {loadingOlder ? t("loading") : t("loadEarlier")}
            </button>
          )}
          <div className="sc-empty">
            <span className="sc-empty-pill">{t("noMessagesYet")}</span>
          </div>
        </div>
        <TypingLine names={typing} />
      </div>
    );
  }

  // The divider sits before the first message the reader had not seen.
  const firstUnreadIndex =
    unreadOnOpen > 0 && unreadOnOpen < messages.length ? messages.length - unreadOnOpen : -1;

  const newest = messages[messages.length - 1];

  return (
    <div className="sc-messages-wrap">
      {/* Screen readers get the newest message without the list stealing focus. */}
      <div className="sc-visually-hidden" aria-live="polite" aria-atomic="true">
        {newest && !newest.pending ? `${newest.senderName}: ${newest.body.text}` : ""}
      </div>
      <div className="sc-messages" ref={scrollRef} onScroll={onScroll} role="log">
        {hasOlder && (
          <button className="sc-load-older" onClick={onLoadOlder} disabled={loadingOlder}>
            {loadingOlder ? t("loading") : t("loadEarlier")}
          </button>
        )}

        {group(messages, lang, t).map(({ message, firstOfGroup, lastOfGroup, dayLabel }, index) => {
          const out = message.senderId === myUserId;
          const mentions = message.body.mentions ?? [];
          const quoted = message.body.replyToId
            ? messages.find((m) => m.id === message.body.replyToId)
            : undefined;
          return (
            <React.Fragment key={message.id}>
              {index === firstUnreadIndex && (
                <div className="sc-unread-line">
                  <span>{t("unreadMessages")}</span>
                </div>
              )}
              {dayLabel && <div className="sc-day">{dayLabel}</div>}
              <div
                data-message-id={message.id}
                className={
                  "sc-row" +
                  (out ? " out" : "") +
                  (lastOfGroup ? " tail" : " grouped") +
                  (message.pending ? " pending" : "") +
                  (message.failed ? " failed" : "") +
                  (message.id === highlightId ? " flash" : "")
                }
              >
                {!out &&
                  (lastOfGroup ? (
                    <Avatar name={message.senderName} seed={message.senderId} small />
                  ) : (
                    <span className="sc-avatar-slot" />
                  ))}
                <div className="sc-bubble">
                  {showAuthors && !out && firstOfGroup && (
                    <span className="sc-author">{message.senderName}</span>
                  )}

                  {message.body.replyToId && (
                    <div className="sc-quote">
                      <span className="sc-quote-author">
                        {quoted ? quoted.senderName : t("attachment")}
                      </span>
                      <span className="sc-quote-text">
                        {quoted ? quoted.body.text || t("attachment") : t("unavailable")}
                      </span>
                    </div>
                  )}

                  {message.deleted ? (
                    <div className="sc-text deleted">{t("messageDeleted")}</div>
                  ) : (
                    <div className="sc-text">
                      {segment(message.body.text, mentions).map((part, i) =>
                        part.type === "text" ? (
                          <React.Fragment key={i}>{part.text}</React.Fragment>
                        ) : (
                          <MentionChip key={i} mention={part.mention} />
                        )
                      )}
                    </div>
                  )}

                  {(message.body.attachments ?? []).map((attachment) => (
                    <Attachment
                      key={attachment.blobId}
                      attachment={attachment}
                      imageUrl={imageUrl}
                      onDownload={onDownload}
                    />
                  ))}

                  <span className="sc-meta">
                    {message.body.editedAt && <span className="sc-edited">{t("edited")}</span>}
                    {message.failed
                      ? t("failedToSend")
                      : message.pending
                        ? t("sending")
                        : formatTime(message.sentAt, lang)}
                  </span>

                  {!message.deleted && !message.pending && (
                    <span className="sc-bubble-actions">
                      <button title={t("react")} aria-label={t("react")} onClick={() => setPicking(message.id)}>
                        <Icon path={ICONS.smile} size={13} />
                      </button>
                      <button title={t("reply")} aria-label={t("reply")} onClick={() => onReply(message)}>
                        <Icon path={ICONS.reply} size={13} />
                      </button>
                      {out && (
                        <button title={t("edit")} aria-label={t("edit")} onClick={() => onEdit(message)}>
                          <Icon path={ICONS.compose} size={13} />
                        </button>
                      )}
                      {out && (
                        <button title={t("del")} aria-label={t("del")} onClick={() => onDelete(message)}>
                          <Icon path={ICONS.trash} size={13} />
                        </button>
                      )}
                    </span>
                  )}

                  {picking === message.id && (
                    <ReactionPicker
                      onClose={() => setPicking(undefined)}
                      onPick={(emoji) => {
                        setPicking(undefined);
                        onReact(message, emoji);
                      }}
                    />
                  )}

                  {message.reactions && (
                    <Reactions
                      reactions={message.reactions}
                      myUserId={myUserId}
                      nameOf={nameOf}
                      onToggle={(emoji) => onReact(message, emoji)}
                    />
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={endRef} />
      </div>

      <TypingLine names={typing} />

      {!atBottom && (
        <button
          className="sc-jump"
          title={t("jumpToLatest")}
          aria-label={t("jumpToLatest")}
          onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })}
        >
          <Icon path={ICONS.down} size={20} />
        </button>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* composer                                                            */
/* ------------------------------------------------------------------ */

export const Composer: React.FC<{
  people: Person[];
  disabled?: boolean;
  replyTo?: DecryptedMessage;
  editing?: DecryptedMessage;
  onCancelReply?: () => void;
  onCancelEdit?: () => void;
  onTyping?: (active: boolean) => void;
  onSend: (text: string, files: File[]) => Promise<void>;
  onSaveEdit?: (text: string) => Promise<void>;
}> = ({
  people,
  disabled,
  replyTo,
  editing,
  onCancelReply,
  onCancelEdit,
  onTyping,
  onSend,
  onSaveEdit,
}) => {
  const { t } = useLang();
  const [text, setText] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const areaRef = React.useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [nextFileKey, setNextFileKey] = React.useState(0);
  const keyedFiles = React.useRef(new Map<File, number>());

  // Focus the box when a reply or an edit is started, so typing just works.
  React.useEffect(() => {
    if (replyTo) areaRef.current?.focus();
  }, [replyTo]);

  React.useEffect(() => {
    if (!editing) return;
    setText(editing.body.text);
    setFiles([]);
    const area = areaRef.current;
    area?.focus();
    // Caret at the end, not the start: an edit is usually an append or a fix
    // near where the author stopped typing.
    window.setTimeout(() => area?.setSelectionRange(area.value.length, area.value.length), 0);
  }, [editing?.id]);

  const addFiles = (incoming: File[]) => {
    if (!incoming.length) return;
    let key = nextFileKey;
    for (const file of incoming) keyedFiles.current.set(file, key++);
    setNextFileKey(key);
    setFiles((current) => [...current, ...incoming]);
  };

  // Grow the box with the text, up to the CSS max-height.
  React.useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 160)}px`;
  }, [text]);

  // Tell the conversation we are typing, and stop when the box empties or
  // the component goes away. The client throttles the actual write.
  React.useEffect(() => {
    if (editing) return;
    onTyping?.(text.trim().length > 0);
  }, [text, editing, onTyping]);

  React.useEffect(
    () => () => {
      onTyping?.(false);
    },
    [onTyping]
  );

  const trailingMention = React.useMemo(() => {
    const match = /(?:^|[\s(])@([^\s@]{0,40})$/.exec(text);
    return match ? match[1] : undefined;
  }, [text]);

  const suggestions = React.useMemo(() => {
    if (trailingMention === undefined) return [];
    const needle = trailingMention.toLowerCase();
    return people.filter((p) => p.displayName.toLowerCase().includes(needle)).slice(0, 6);
  }, [trailingMention, people]);

  const applySuggestion = (person: Person) => {
    setText((current) => current.replace(/@([^\s@]{0,40})$/, `@${person.displayName} `));
    areaRef.current?.focus();
  };

  const submit = async () => {
    if (busy || disabled) return;
    const body = text.trim();
    if (editing) {
      if (!body || !onSaveEdit) return;
      setBusy(true);
      setError(undefined);
      try {
        await onSaveEdit(body);
        setText("");
        onCancelEdit?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!body && files.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSend(body, files);
      setText("");
      setFiles([]);
      keyedFiles.current.clear();
      onTyping?.(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={"sc-composer" + (dragging ? " dragging" : "") + (editing ? " editing" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!editing) addFiles(Array.from(e.dataTransfer.files ?? []));
      }}
    >
      {editing && (
        <div className="sc-reply-bar">
          <span className="sc-reply-text">
            <strong>{t("edit")}</strong> {editing.body.text}
          </span>
          <button
            className="sc-icon-btn"
            onClick={() => {
              setText("");
              onCancelEdit?.();
            }}
            title={t("cancel")}
            aria-label={t("cancel")}
          >
            <Icon path={ICONS.close} size={14} />
          </button>
        </div>
      )}

      {!editing && replyTo && (
        <div className="sc-reply-bar">
          <span className="sc-reply-text">
            <strong>{replyTo.senderName}</strong> {replyTo.body.text || t("attachment")}
          </span>
          <button className="sc-icon-btn" onClick={onCancelReply} title={t("cancelReply")} aria-label={t("cancelReply")}>
            <Icon path={ICONS.close} size={14} />
          </button>
        </div>
      )}

      {error && (
        <div className="sc-attach-chips">
          <span className="sc-error" style={{ margin: 0 }}>
            {error}
          </span>
        </div>
      )}

      {files.length > 0 && (
        <div className="sc-attach-chips">
          {files.map((file) => (
            // Keyed by identity, not by name: two screenshots pasted in a
            // row are both "image.png".
            <span className="sc-attach-chip" key={keyedFiles.current.get(file) ?? file.name}>
              {file.name} {"·"} {formatBytes(file.size)}
            </span>
          ))}
          <button className="sc-attach-chip" onClick={() => setFiles([])} title={t("removeFiles")}>
            <Icon path={ICONS.close} size={12} />
          </button>
        </div>
      )}

      <div className="sc-composer-inner">
        <div className="sc-composer-box">
          {suggestions.length > 0 && (
            <div className="sc-suggest">
              {suggestions.map((person) => (
                <button key={person.userId} onClick={() => applySuggestion(person)}>
                  <Avatar name={person.displayName} seed={person.userId} small />
                  <span>{person.displayName}</span>
                </button>
              ))}
            </div>
          )}

          {!editing && (
            <label className="sc-icon-btn sc-attach-label" title={t("attachFile")}>
              <input
                type="file"
                multiple
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <Icon path={ICONS.attach} size={20} />
            </label>
          )}

          <textarea
            ref={areaRef}
            rows={1}
            disabled={disabled || busy}
            placeholder={editing ? t("editingPlaceholder") : t("composerPlaceholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              // Pasting a screenshot is how developers share most images.
              if (editing) return;
              const pasted = Array.from(e.clipboardData?.files ?? []);
              if (pasted.length) {
                e.preventDefault();
                addFiles(pasted);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              } else if (e.key === "Escape" && editing) {
                setText("");
                onCancelEdit?.();
              }
            }}
          />
        </div>

        <button
          className="sc-send"
          disabled={disabled || busy || (!text.trim() && files.length === 0)}
          onClick={() => void submit()}
          title={editing ? t("save") : t("send")}
          aria-label={editing ? t("save") : t("send")}
        >
          <Icon path={ICONS.send} size={20} />
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* dialogs                                                             */
/* ------------------------------------------------------------------ */

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children,
}) => {
  const cardRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Escape closes, and focus returns to whatever opened the dialog - the
    // minimum a keyboard user is entitled to expect.
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    cardRef.current?.querySelector<HTMLElement>("input, button, textarea")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="sc-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="sc-card" ref={cardRef} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
};

/**
 * Confirmation dialog.
 *
 * Replaces `window.confirm`, which an extension must not rely on: the host
 * iframe is sandboxed, and a sandbox without `allow-modals` makes
 * `confirm()` return false without showing anything - so the action looked
 * like a dead click rather than a cancelled one.
 */
export const Confirm: React.FC<{
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ title, body, confirmLabel, busy, danger = true, onConfirm, onClose }) => {
  const { t } = useLang();
  return (
    <Modal title={title} onClose={onClose}>
      {body}
      <div className="sc-row-actions">
        <button className="sc-btn" disabled={busy} onClick={onClose}>
          {t("cancel")}
        </button>
        <button
          className={`sc-btn ${danger ? "danger" : "primary"}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? t("deleting") : confirmLabel}
        </button>
      </div>
    </Modal>
  );
};

export const PeoplePicker: React.FC<{
  people: Person[];
  multi: boolean;
  selected: string[];
  status?: DirectoryStatus;
  onSearch?: (query: string) => Promise<Person[]>;
  onToggle: (userId: string) => void;
}> = ({ people, multi, selected, status, onSearch, onToggle }) => {
  const { t } = useLang();
  const [filter, setFilter] = React.useState("");
  const [remote, setRemote] = React.useState<Person[]>([]);

  React.useEffect(() => {
    if (!onSearch || filter.trim().length < 2) {
      setRemote([]);
      return;
    }
    let alive = true;
    const handle = window.setTimeout(() => {
      void onSearch(filter.trim()).then((found) => {
        if (alive) setRemote(found);
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [filter, onSearch]);

  const merged = React.useMemo(() => {
    const byId = new Map(people.map((p) => [p.userId, p]));
    for (const person of remote) if (!byId.has(person.userId)) byId.set(person.userId, person);
    return [...byId.values()];
  }, [people, remote]);

  const shown = merged.filter((p) => p.displayName.toLowerCase().includes(filter.toLowerCase()));

  // An empty picker has several very different causes. Say which one it is -
  // an authorisation failure must not read as "nobody is here".
  const emptyReason = (): string => {
    if (filter.trim().length >= 2 && onSearch) return t("nobodyMatching", { query: filter });
    if (filter) return t("keepTyping");
    if (status?.error) return `${t("directoryUnreadable")} ${status.error}`;
    if (status?.source === "none") return t("directoryUnreadable");
    return t("noPeople");
  };

  return (
    <>
      <div className="sc-field">
        <input
          type="search"
          placeholder={t("searchPeople")}
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="sc-people">
        {shown.length === 0 && <div className="sc-empty">{emptyReason()}</div>}
        {shown.map((person) => (
          <button
            key={person.userId}
            type="button"
            className="sc-person"
            onClick={() => onToggle(person.userId)}
          >
            {multi && (
              <input
                type="checkbox"
                readOnly
                checked={selected.includes(person.userId)}
                className="sc-check"
              />
            )}
            <Avatar name={person.displayName} seed={person.userId} small />
            <span className="sc-person-name">{person.displayName}</span>
          </button>
        ))}
      </div>
    </>
  );
};

/** Current members of a channel, with remove buttons. */
export const MemberList: React.FC<{
  members: string[];
  myUserId: string;
  nameOf: (userId: string) => string;
  presenceOf?: (userId: string) => { lastSeenAt?: string; online: boolean };
  onRemove?: (userId: string) => void;
}> = ({ members, myUserId, nameOf, presenceOf, onRemove }) => {
  const { lang, t } = useLang();
  return (
    <div className="sc-people">
      {members.map((userId) => {
        const presence = presenceOf?.(userId);
        return (
          <div className="sc-person" key={userId}>
            <Avatar name={nameOf(userId)} seed={userId} small online={presence?.online} />
            <span className="sc-person-name">
              {nameOf(userId)}
              {presence && (
                <span className="sc-person-sub">
                  {presence.online
                    ? t("onlineNow")
                    : presence.lastSeenAt
                      ? t("lastSeen", { when: formatSeen(presence.lastSeenAt, lang) })
                      : ""}
                </span>
              )}
            </span>
            {onRemove && userId !== myUserId && (
              <button
                className="sc-icon-btn"
                title={t("removePerson")}
                aria-label={t("removePerson")}
                onClick={() => onRemove(userId)}
              >
                <Icon path={ICONS.close} size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export { ICONS, Icon, formatBytes, formatTime, formatSeen };
