/**
 * Hub.tsx - the Team Chat page.
 *
 * Owns the ChatClient and all state; everything below it is presentational.
 * There is no setup flow and no key management: identity comes from the
 * Azure DevOps SDK, and messages are stored in the clear (see overview.md
 * for what that means).
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

import "../styles.css";

import { ChatClient, Person, bootstrap } from "@core/client";
import { parseMentions } from "@core/mentions";
import { saveBlob } from "@core/files";
import {
  applyLanguage,
  guessLanguage,
  translator,
  type Lang,
} from "@core/i18n";
import {
  notifyNewMessages,
  requestDesktopPermission,
  type UnreadSummary,
} from "@core/notifications";
import type {
  AttachmentManifest,
  ConversationDoc,
  ConversationSubject,
  ConversationView,
  DecryptedMessage,
  SearchHit,
} from "@core/model";
import {
  Avatar,
  Bell,
  Composer,
  Confirm,
  ConversationList,
  ICONS,
  Icon,
  LangContext,
  LanguageToggle,
  MemberList,
  MessageList,
  Modal,
  PeoplePicker,
  SearchResults,
  formatSeen,
} from "./components";

const PENDING_SUBJECT_KEY = "pending-subject";
const LANGUAGE_KEY = "ui-language";

/** Messages fetched per page when scrolling back. */
const PAGE = 60;

/**
 * Mirror the host's light/dark choice onto <html data-theme>.
 *
 * Azure DevOps injects CSS variables but no theme flag, and its theme is a
 * product setting rather than an OS one - so `prefers-color-scheme` is the
 * wrong signal. Sampling the background colour it gives us is reliable.
 */
function applyHostTheme(): void {
  const probe = getComputedStyle(document.documentElement).getPropertyValue("--background-color");
  const match = /(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(probe) ?? /#([0-9a-f]{6})/i.exec(probe.trim());
  let dark = false;
  if (match && match.length === 4) {
    const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
    dark = 0.299 * r + 0.587 * g + 0.114 * b < 128;
  } else if (match) {
    const hex = match[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    dark = 0.299 * r + 0.587 * g + 0.114 * b < 128;
  } else {
    dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  }
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

type Phase = "loading" | "ready" | "error";
type Dialog = "dm" | "channel" | "delete" | "deleteMessage" | "members" | "rename";

const App: React.FC = () => {
  const [client, setClient] = React.useState<ChatClient>();
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [lang, setLang] = React.useState<Lang>("en");

  const [people, setPeople] = React.useState<Person[]>([]);
  const [conversations, setConversations] = React.useState<ConversationView[]>([]);
  const [unread, setUnread] = React.useState<UnreadSummary>({
    total: 0,
    perConversation: {},
    active: [],
  });
  const [selectedId, setSelectedId] = React.useState<string>();
  const [messages, setMessages] = React.useState<DecryptedMessage[]>([]);
  const [dialog, setDialog] = React.useState<Dialog>();
  const [deleteReport, setDeleteReport] = React.useState<string>();
  const [picked, setPicked] = React.useState<string[]>([]);
  const [channelName, setChannelName] = React.useState("");
  const [limit, setLimit] = React.useState(PAGE);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [total, setTotal] = React.useState(0);
  const [unreadOnOpen, setUnreadOnOpen] = React.useState(0);
  const [replyTo, setReplyTo] = React.useState<DecryptedMessage>();
  const [editing, setEditing] = React.useState<DecryptedMessage>();
  const [pendingDelete, setPendingDelete] = React.useState<DecryptedMessage>();
  const [typing, setTyping] = React.useState<string[]>([]);
  const [highlightId, setHighlightId] = React.useState<string>();

  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [truncated, setTruncated] = React.useState(false);

  const t = React.useMemo(() => translator(lang), [lang]);

  const lastNotified = React.useRef<Record<string, number>>({});
  /**
   * The poller is started once and reads the current selection from here.
   * Keeping `selectedId` in the effect's dependency list tore the poller
   * down and rebuilt it on every conversation switch, and reading it from
   * the effect's closure gave the notification filter a value that was
   * stale for the whole session.
   */
  const selectedRef = React.useRef<string | undefined>(undefined);
  selectedRef.current = selectedId;
  const limitRef = React.useRef(PAGE);
  // Stable identity so the picker's debounced search effect does not reset
  // on every poll-driven re-render.
  const searchFn = React.useMemo(
    () => (client ? (q: string) => client.search(q) : undefined),
    [client]
  );

  /* ---------------------------------------------------------------- */
  /* boot                                                             */
  /* ---------------------------------------------------------------- */

  React.useEffect(() => {
    void (async () => {
      try {
        const c = await bootstrap();
        applyHostTheme();
        const saved = await c.store.getValue<string>(LANGUAGE_KEY, "user").catch(() => undefined);
        const initial = guessLanguage(saved);
        setLang(initial);
        applyLanguage(initial);
        setClient(c);
        setPhase("ready");
        void requestDesktopPermission();
        // Anything that slips every catch still surfaces instead of dying
        // silently behind a dialog.
        window.addEventListener("unhandledrejection", (event) => {
          console.error("[team-chat] unhandled", event.reason);
          setError(event.reason instanceof Error ? event.reason.message : String(event.reason));
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();
  }, []);

  const changeLanguage = React.useCallback(
    (next: Lang) => {
      setLang(next);
      applyLanguage(next);
      void client?.store.setValue(LANGUAGE_KEY, next, "user").catch((err) =>
        console.warn("[team-chat] language preference not saved", err)
      );
    },
    [client]
  );

  /* ---------------------------------------------------------------- */
  /* live data                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * `includePeople` is false on poll ticks. Conversations change constantly;
   * the people directory almost never does, and fetching it on every tick
   * was a whole extra round trip plus a re-render for nothing.
   */
  const refresh = React.useCallback(async (c: ChatClient, includePeople = true) => {
    const { views, unread: summary } = await c.listConversations();
    setConversations(views);
    setUnread(summary);
    if (includePeople) {
      const directory = await c.people();
      setPeople(directory.filter((p) => p.userId !== c.me.userId));
    }
    return views;
  }, []);

  const loadMessages = React.useCallback(
    async (c: ChatClient, convId: string, take: number, markUnread = false) => {
      const { items, total: count } = await c.recentWindow(convId, take);
      setMessages(items);
      setTotal(count);
      const wasUnread = await c.markRead(convId);
      if (markUnread) setUnreadOnOpen(wasUnread);
    },
    []
  );

  React.useEffect(() => {
    if (phase !== "ready" || !client) return;
    let alive = true;

    void (async () => {
      const views = await refresh(client);
      if (!alive) return;

      // A "Discuss in Team Chat" action parks its target here.
      const pending = await client.store.getValue<{
        subject: ConversationSubject;
        title: string;
      }>(PENDING_SUBJECT_KEY, "user");
      if (pending && alive) {
        await client.store.setValue(PENDING_SUBJECT_KEY, null, "user");
        try {
          const doc = await client.openSubject(pending.subject, pending.title, []);
          await refresh(client);
          setSelectedId(doc.id);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } else if (!selectedRef.current && views.length) {
        setSelectedId(views[0].id);
      }
    })();

    client.startPolling(
      async (summary) => {
        if (!alive) return;
        const views = await refresh(client, false);
        const titleOf = (convId: string) =>
          views.find((v) => v.id === convId)?.title ?? "Team Chat";

        for (const entry of summary.active) {
          if (lastNotified.current[entry.convId] === entry.count) continue;
          lastNotified.current[entry.convId] = entry.count;
          // selectedRef, not the captured `selectedId`: the latter is fixed
          // at the value it had when polling started, so every toast for
          // the conversation already on screen got through.
          if (entry.convId === selectedRef.current && !document.hidden) continue;
          notifyNewMessages(
            client.nameOf(entry.lastSenderId ?? ""),
            titleOf(entry.convId),
            entry.count,
            entry.convId
          );
        }
      },
      () => selectedRef.current,
      async (conv: ConversationDoc) => {
        if (!alive) return;
        setTyping(client.typersIn(conv));
        await loadMessages(client, conv.id, limitRef.current);
      }
    );

    // Image previews hold object URLs; let them go with the page.
    const release = () => client.releaseImageUrls();
    window.addEventListener("pagehide", release);

    return () => {
      alive = false;
      client.stopPolling();
      window.removeEventListener("pagehide", release);
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, client]);

  // Opening a conversation resets paging and captures the unread count, which
  // is what positions the "unread messages" divider.
  React.useEffect(() => {
    if (!client || !selectedId || phase !== "ready") return;
    setLimit(PAGE);
    limitRef.current = PAGE;
    setReplyTo(undefined);
    setEditing(undefined);
    setUnreadOnOpen(0);
    setTyping([]);
    void loadMessages(client, selectedId, PAGE, true).catch((err) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, [client, selectedId, phase, loadMessages]);

  limitRef.current = limit;

  const loadOlder = React.useCallback(() => {
    if (!client || !selectedId || loadingOlder) return;
    if (messages.length >= total) return;
    setLoadingOlder(true);
    const next = limit + PAGE;
    void loadMessages(client, selectedId, next)
      .then(() => setLimit(next))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingOlder(false));
  }, [client, selectedId, loadingOlder, limit, loadMessages, messages.length, total]);

  /* ---------------------------------------------------------------- */
  /* search                                                           */
  /* ---------------------------------------------------------------- */

  React.useEffect(() => {
    if (!client || query.trim().length < 2) {
      setHits([]);
      setTruncated(false);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const handle = window.setTimeout(() => {
      void client
        .searchMessages(query)
        .then((result) => {
          if (!alive) return;
          setHits(result.hits);
          setTruncated(result.truncated);
        })
        .catch((err) => {
          if (alive) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [client, query]);

  /**
   * Open a search hit. The message may be far back in history, so paging is
   * widened to reach it before the list is asked to scroll there.
   */
  const openHit = async (hit: SearchHit) => {
    if (!client) return;
    const conv = await client.getConversation(hit.convId);
    const seq = hit.message.seq;
    const needed =
      conv && seq !== undefined ? Math.max(PAGE, conv.messageCount - seq + 10) : PAGE * 4;
    setQuery("");
    setSelectedId(hit.convId);
    setLimit(needed);
    limitRef.current = needed;
    setHighlightId(hit.message.id);
    window.setTimeout(() => setHighlightId(undefined), 2500);
    try {
      await loadMessages(client, hit.convId, needed, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /* ---------------------------------------------------------------- */
  /* actions                                                          */
  /* ---------------------------------------------------------------- */

  const handleSend = async (text: string, files: File[]) => {
    if (!client || !selectedId) return;
    const convId = selectedId;

    // Show the message immediately. Sending is two dependent writes plus any
    // attachment uploads; waiting for that round trip before anything appears
    // is what made the chat feel slow.
    const optimisticId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic: DecryptedMessage = {
      id: optimisticId,
      senderId: client.me.userId,
      senderName: client.me.displayName,
      sentAt: new Date().toISOString(),
      body: { text, replyToId: replyTo?.id },
      pending: true,
    };
    setMessages((current) => [...current, optimistic]);
    setReplyTo(undefined);

    try {
      const attachments: AttachmentManifest[] = [];
      for (const file of files) {
        attachments.push(await client.uploadAttachment(convId, file));
      }

      const mentions = parseMentions(text, {
        knownUsers: [
          ...people.map((p) => ({ userId: p.userId, displayName: p.displayName })),
          { userId: client.me.userId, displayName: client.me.displayName },
        ],
      });

      const sent = await client.send(convId, {
        text,
        mentions: mentions.length ? mentions : undefined,
        attachments: attachments.length ? attachments : undefined,
        replyToId: optimistic.body.replyToId,
      });

      // Swap the placeholder for the stored message.
      setMessages((current) => current.map((m) => (m.id === optimisticId ? sent : m)));
      setTotal((n) => n + 1);
    } catch (err) {
      // Take the placeholder back out and let the composer keep the text so
      // the message is not silently lost.
      setMessages((current) => current.filter((m) => m.id !== optimisticId));
      throw err;
    }

    // Everything past this point is presentation. The message is already
    // delivered, so a failure refreshing the view must NOT be reported as a
    // failed send - doing that is what left text sitting in the composer.
    void (async () => {
      try {
        await loadMessages(client, convId, limitRef.current);
        await refresh(client, false);
      } catch (err) {
        console.warn("[team-chat] refresh after send failed", err);
      }
    })();
  };

  const handleSaveEdit = async (text: string) => {
    if (!client || !selectedId || !editing) return;
    const target = editing;
    const mentions = parseMentions(text, {
      knownUsers: [
        ...people.map((p) => ({ userId: p.userId, displayName: p.displayName })),
        { userId: client.me.userId, displayName: client.me.displayName },
      ],
    });
    // Attachments are part of the original body and are not re-uploaded by
    // an edit, so they have to be carried across explicitly.
    await client.editMessage(selectedId, target.id, {
      ...target.body,
      text,
      mentions: mentions.length ? mentions : undefined,
    });
    setEditing(undefined);
    await loadMessages(client, selectedId, limitRef.current);
    await refresh(client, false);
  };

  const handleReact = async (message: DecryptedMessage, emoji: string) => {
    if (!client || !selectedId) return;
    const convId = selectedId;
    const me = client.me.userId;

    // Optimistic: a reaction is one click and must feel instant, and the
    // toggle is computed the same way the server does it.
    setMessages((current) =>
      current.map((m) => {
        if (m.id !== message.id) return m;
        const reactions: Record<string, string[]> = {};
        for (const [key, users] of Object.entries(m.reactions ?? {})) reactions[key] = [...users];
        const mine = reactions[emoji] ?? [];
        if (mine.includes(me)) {
          const left = mine.filter((u) => u !== me);
          if (left.length) reactions[emoji] = left;
          else delete reactions[emoji];
        } else {
          reactions[emoji] = [...mine, me];
        }
        return { ...m, reactions };
      })
    );

    try {
      await client.react(convId, message.id, emoji);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await loadMessages(client, convId, limitRef.current).catch(() => undefined);
    }
  };

  /**
   * Bound to one conversation, and rebuilt when the selection changes.
   *
   * The composer clears the flag in its effect cleanup. With a callback
   * that read the *current* selection, switching conversations cleared the
   * flag on the conversation just opened instead of the one being left -
   * so your own typing dot lingered where you were no longer typing, and a
   * pointless write landed where you were.
   */
  const handleTyping = React.useMemo(() => {
    if (!client || !selectedId) return undefined;
    const convId = selectedId;
    return (active: boolean) => void client.setTyping(convId, active);
  }, [client, selectedId]);

  const handleDownload = async (attachment: AttachmentManifest) => {
    if (!client) return;
    saveBlob(await client.downloadAttachment(attachment), attachment.name);
  };

  const confirmDeleteMessage = async () => {
    if (!client || !selectedId || !pendingDelete) return;
    setBusy(true);
    try {
      await client.deleteMessage(selectedId, pendingDelete.id, pendingDelete.body.attachments);
      setPendingDelete(undefined);
      setDialog(undefined);
      await loadMessages(client, selectedId, limitRef.current);
      await refresh(client, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteConversation = async () => {
    if (!client || !selectedId) return;
    setBusy(true);
    setError(undefined);
    try {
      const report = await client.deleteConversation(selectedId);
      setSelectedId(undefined);
      setMessages([]);
      setDialog(undefined);
      setDeleteReport(
        `${report.pagesRemoved} page(s), ${report.attachmentsRemoved} attachment(s) removed.`
      );
      await refresh(client);
    } catch (err) {
      console.error("[team-chat] delete failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startDirect = async (userId: string) => {
    if (!client) return;
    setBusy(true);
    setError(undefined);
    try {
      const doc = await client.openDirect(userId);
      // Select and close FIRST. A directory refresh must never sit between
      // the click and the conversation opening.
      setSelectedId(doc.id);
      setDialog(undefined);
      void refresh(client).catch((err) => console.warn("[team-chat] refresh", err));
    } catch (err) {
      // Shown INSIDE the dialog - the header label is behind the modal, so
      // an error there reads as a dead click.
      console.error("[team-chat] open direct failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const createChannel = async () => {
    if (!client || !channelName.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const doc = await client.createChannel(channelName.trim(), picked);
      setSelectedId(doc.id);
      setDialog(undefined);
      setPicked([]);
      setChannelName("");
      void refresh(client).catch((err) => console.warn("[team-chat] refresh", err));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const addMembers = async () => {
    if (!client || !selectedId || picked.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      await client.addMembers(selectedId, picked);
      setPicked([]);
      await refresh(client);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!client || !selectedId) return;
    setError(undefined);
    try {
      await client.removeMembers(selectedId, [userId]);
      await refresh(client);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const renameConversation = async () => {
    if (!client || !selectedId || !channelName.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await client.renameConversation(selectedId, channelName.trim());
      setDialog(undefined);
      setChannelName("");
      await refresh(client);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------------------------------------------- */
  /* render                                                           */
  /* ---------------------------------------------------------------- */

  if (phase === "loading") {
    return <div className="sc-empty">{t("loading")}</div>;
  }

  if (phase === "error") {
    return (
      <LangContext.Provider value={{ lang, t }}>
        <div className="sc-center">
          <div className="sc-card">
            <h2>{t("couldNotStart")}</h2>
            <div className="sc-error">{error}</div>
          </div>
        </div>
      </LangContext.Provider>
    );
  }

  const selected = conversations.find((c) => c.id === selectedId);
  const other =
    selected?.kind === "dm" ? selected.members.find((m) => m !== client?.me.userId) : undefined;
  const otherPresence = other && client ? client.presenceOf(other) : undefined;
  const searchMode = query.trim().length > 0;

  const subtitle = (): string => {
    if (!selected) return "";
    if (selected.kind !== "dm") return t("members", { n: selected.members.length });
    if (!otherPresence) return t("directMessage");
    if (otherPresence.online) return t("onlineNow");
    if (otherPresence.lastSeenAt) {
      return t("lastSeen", { when: formatSeen(otherPresence.lastSeenAt, lang) });
    }
    return t("directMessage");
  };

  return (
    <LangContext.Provider value={{ lang, t }}>
      <div className="sc-app">
        <ConversationList
          items={conversations}
          selectedId={selectedId}
          myUserId={client?.me.userId ?? ""}
          nameOf={client ? client.nameOf : (id) => id}
          query={query}
          onQuery={setQuery}
          onSelect={setSelectedId}
          onNewDirect={() => {
            setPicked([]);
            setError(undefined);
            setDialog("dm");
          }}
          onNewChannel={() => {
            setPicked([]);
            setError(undefined);
            setDialog("channel");
          }}
        >
          {searchMode ? (
            <SearchResults
              hits={hits}
              busy={searching}
              truncated={truncated}
              query={query}
              onOpen={(hit) => void openHit(hit)}
            />
          ) : undefined}
        </ConversationList>

        <main className="sc-main">
          {selected ? (
            <>
              <header className="sc-topbar">
                <Avatar
                  name={selected.title}
                  seed={selected.id}
                  small
                  online={otherPresence?.online}
                />
                <div className="sc-topbar-text">
                  <div className="sc-topbar-title">{selected.title}</div>
                  <div className="sc-topbar-sub">{subtitle()}</div>
                </div>
                <span className="sc-spacer" />
                {error && (
                  <span className="sc-error" style={{ margin: 0 }}>
                    {error}
                  </span>
                )}
                {!error && deleteReport && <span className="sc-hint">{deleteReport}</span>}
                <LanguageToggle lang={lang} onChange={changeLanguage} />
                <Bell
                  count={unread.total}
                  onClick={() => {
                    const first = unread.active[0];
                    if (first) setSelectedId(first.convId);
                  }}
                />
                {selected.kind !== "dm" && (
                  <button
                    className="sc-icon-btn"
                    onClick={() => {
                      setPicked([]);
                      setError(undefined);
                      setDialog("members");
                    }}
                    title={t("manageMembers")}
                    aria-label={t("manageMembers")}
                  >
                    <Icon path={ICONS.people} size={19} />
                  </button>
                )}
                {selected.kind === "channel" && (
                  <button
                    className="sc-icon-btn"
                    onClick={() => {
                      setChannelName(selected.title);
                      setError(undefined);
                      setDialog("rename");
                    }}
                    title={t("renameTitle")}
                    aria-label={t("renameTitle")}
                  >
                    <Icon path={ICONS.compose} size={18} />
                  </button>
                )}
                <button
                  className="sc-icon-btn"
                  onClick={() => {
                    setError(undefined);
                    setDialog("delete");
                  }}
                  title={t("deleteConvTitle")}
                  aria-label={t("deleteConvTitle")}
                >
                  <Icon path={ICONS.trash} size={18} />
                </button>
              </header>

              <MessageList
                messages={messages}
                myUserId={client?.me.userId ?? ""}
                showAuthors={selected.kind !== "dm"}
                nameOf={client ? client.nameOf : (id) => id}
                unreadOnOpen={unreadOnOpen}
                hasOlder={messages.length < total}
                loadingOlder={loadingOlder}
                typing={typing}
                highlightId={highlightId}
                onLoadOlder={loadOlder}
                imageUrl={client ? (a) => client.imageUrl(a) : undefined}
                onDownload={handleDownload}
                onDelete={(m) => {
                  setPendingDelete(m);
                  setDialog("deleteMessage");
                }}
                onReply={setReplyTo}
                onEdit={setEditing}
                onReact={(m, emoji) => void handleReact(m, emoji)}
              />
              <Composer
                people={people}
                replyTo={replyTo}
                editing={editing}
                onCancelReply={() => setReplyTo(undefined)}
                onCancelEdit={() => setEditing(undefined)}
                onTyping={handleTyping}
                onSend={handleSend}
                onSaveEdit={handleSaveEdit}
              />
            </>
          ) : (
            <div className="sc-empty">
              <span className="sc-empty-pill">{t("selectChat")}</span>
            </div>
          )}
        </main>

        {dialog === "dm" && (
          <Modal title={t("newMessage")} onClose={() => setDialog(undefined)}>
            {error && <div className="sc-error">{error}</div>}
            {busy && <div className="sc-hint">{t("openingConversation")}</div>}
            <PeoplePicker
              people={people}
              multi={false}
              selected={picked}
              status={client?.directoryStatus}
              onSearch={searchFn}
              onToggle={(userId) => void startDirect(userId)}
            />
          </Modal>
        )}

        {dialog === "channel" && (
          <Modal title={t("newChannel")} onClose={() => setDialog(undefined)}>
            {error && <div className="sc-error">{error}</div>}
            <div className="sc-field">
              <label htmlFor="sc-channel">{t("channelName")}</label>
              <input
                id="sc-channel"
                type="text"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
              />
            </div>
            <PeoplePicker
              people={people}
              multi
              selected={picked}
              status={client?.directoryStatus}
              onSearch={searchFn}
              onToggle={(userId) =>
                setPicked((current) =>
                  current.includes(userId)
                    ? current.filter((x) => x !== userId)
                    : [...current, userId]
                )
              }
            />
            <div className="sc-row-actions">
              <button className="sc-btn" onClick={() => setDialog(undefined)}>
                {t("cancel")}
              </button>
              <button
                className="sc-btn primary"
                disabled={busy || !channelName.trim()}
                onClick={() => void createChannel()}
              >
                {t("create")}
              </button>
            </div>
          </Modal>
        )}

        {dialog === "members" && selected && client && (
          <Modal title={t("manageMembers")} onClose={() => setDialog(undefined)}>
            {error && <div className="sc-error">{error}</div>}
            <MemberList
              members={selected.members}
              myUserId={client.me.userId}
              nameOf={client.nameOf}
              presenceOf={(id) => client.presenceOf(id)}
              onRemove={(id) => void removeMember(id)}
            />
            <h3 className="sc-subhead">{t("addPeople")}</h3>
            <PeoplePicker
              people={people.filter((p) => !selected.members.includes(p.userId))}
              multi
              selected={picked}
              status={client.directoryStatus}
              onSearch={searchFn}
              onToggle={(userId) =>
                setPicked((current) =>
                  current.includes(userId)
                    ? current.filter((x) => x !== userId)
                    : [...current, userId]
                )
              }
            />
            <div className="sc-row-actions">
              <button className="sc-btn" onClick={() => setDialog(undefined)}>
                {t("cancel")}
              </button>
              <button
                className="sc-btn primary"
                disabled={busy || picked.length === 0}
                onClick={() => void addMembers()}
              >
                {t("addPeople")}
              </button>
            </div>
          </Modal>
        )}

        {dialog === "rename" && selected && (
          <Modal title={t("renameTitle")} onClose={() => setDialog(undefined)}>
            {error && <div className="sc-error">{error}</div>}
            <div className="sc-field">
              <label htmlFor="sc-rename">{t("renameLabel")}</label>
              <input
                id="sc-rename"
                type="text"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
              />
            </div>
            <div className="sc-row-actions">
              <button className="sc-btn" onClick={() => setDialog(undefined)}>
                {t("cancel")}
              </button>
              <button
                className="sc-btn primary"
                disabled={busy || !channelName.trim()}
                onClick={() => void renameConversation()}
              >
                {t("rename")}
              </button>
            </div>
          </Modal>
        )}

        {dialog === "deleteMessage" && pendingDelete && (
          <Confirm
            title={t("deleteMsgTitle")}
            body={<p>{t("deleteMsgBody")}</p>}
            confirmLabel={t("deleteForEveryone")}
            busy={busy}
            onConfirm={() => void confirmDeleteMessage()}
            onClose={() => {
              setPendingDelete(undefined);
              setDialog(undefined);
            }}
          />
        )}

        {dialog === "delete" && selected && (
          <Confirm
            title={t("deleteConvTitle")}
            confirmLabel={t("deleteForEveryone")}
            busy={busy}
            onConfirm={() => void deleteConversation()}
            onClose={() => setDialog(undefined)}
            body={
              <>
                {error && <div className="sc-error">{error}</div>}
                <p>{t("deleteConvBody", { title: selected.title })}</p>
                <p>{t("deleteConvShared", { n: selected.members.length })}</p>
                <p className="sc-hint">{t("deleteConvNote")}</p>
              </>
            }
          />
        )}
      </div>
    </LangContext.Provider>
  );
};

const container = document.getElementById("root");
if (container) createRoot(container).render(<App />);
