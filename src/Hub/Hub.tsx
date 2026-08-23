/**
 * Hub.tsx - the Secure Chat page.
 *
 * Owns the ChatClient and all state. Everything below it is presentational.
 * There is no setup flow: identity is created silently, key repair runs in
 * the background, and clear/encrypted mode is decided per conversation from
 * who has keys - never asked.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

import "../styles.css";

import { ChatClient, Person, bootstrap } from "@core/client";
import { parseMentions } from "@core/mentions";
import { saveBlob } from "@core/files";
import {
  notifyNewMessages,
  requestDesktopPermission,
  type UnreadSummary,
} from "@core/notifications";
import type {
  AttachmentManifest,
  ConversationSubject,
  ConversationView,
  DecryptedMessage,
} from "@core/model";
import {
  Bell,
  Composer,
  ConversationList,
  MessageList,
  Modal,
  PeoplePicker,
} from "./components";

const PENDING_SUBJECT_KEY = "pending-subject";

type Phase = "loading" | "ready" | "error";

const App: React.FC = () => {
  const [client, setClient] = React.useState<ChatClient>();
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const [people, setPeople] = React.useState<Person[]>([]);
  const [conversations, setConversations] = React.useState<ConversationView[]>([]);
  const [unread, setUnread] = React.useState<UnreadSummary>({
    total: 0,
    perConversation: {},
    active: [],
  });
  const [selectedId, setSelectedId] = React.useState<string>();
  const [messages, setMessages] = React.useState<DecryptedMessage[]>([]);
  const [dialog, setDialog] = React.useState<"dm" | "channel" | "delete">();
  const [deleteReport, setDeleteReport] = React.useState<string>();
  const [picked, setPicked] = React.useState<string[]>([]);
  const [channelName, setChannelName] = React.useState("");

  const lastNotified = React.useRef<Record<string, number>>({});
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
        setClient(c);
        setPhase("ready");
        void requestDesktopPermission();
        // Anything that slips every catch still surfaces instead of dying
        // silently behind a dialog.
        window.addEventListener("unhandledrejection", (event) => {
          console.error("[secure-chat] unhandled", event.reason);
          setError(
            event.reason instanceof Error ? event.reason.message : String(event.reason)
          );
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();
  }, []);

  /* ---------------------------------------------------------------- */
  /* live data                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * `includePeople` is false on poll ticks. Conversations change constantly;
   * the people directory almost never does, and fetching it every twelve
   * seconds was a whole extra round trip plus a re-render for nothing.
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

  const loadMessages = React.useCallback(async (c: ChatClient, convId: string) => {
    setMessages(await c.recent(convId));
    await c.markRead(convId);
  }, []);

  React.useEffect(() => {
    if (phase !== "ready" || !client) return;
    let alive = true;

    void (async () => {
      const views = await refresh(client);
      if (!alive) return;

      // A "Discuss in Secure Chat" action parks its target here.
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
      } else if (!selectedId && views.length) {
        setSelectedId(views[0].id);
      }
    })();

    client.startPolling(async (summary) => {
      if (!alive) return;
      const views = await refresh(client, false);
      const titleOf = (convId: string) =>
        views.find((v) => v.id === convId)?.title ?? "Secure Chat";

      for (const entry of summary.active) {
        if (lastNotified.current[entry.convId] === entry.count) continue;
        lastNotified.current[entry.convId] = entry.count;
        if (entry.convId === selectedId && !document.hidden) continue;
        notifyNewMessages(client.nameOf(entry.lastSenderId ?? ""), titleOf(entry.convId), entry.count);
      }

      if (selectedId) await loadMessages(client, selectedId);
    });

    return () => {
      alive = false;
      client.stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, client, selectedId]);

  React.useEffect(() => {
    if (!client || !selectedId || phase !== "ready") return;
    void loadMessages(client, selectedId).catch((err) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, [client, selectedId, phase, loadMessages]);

  /* ---------------------------------------------------------------- */
  /* actions                                                          */
  /* ---------------------------------------------------------------- */

  const handleSend = async (text: string, files: File[]) => {
    if (!client || !selectedId) return;

    const attachments: AttachmentManifest[] = [];
    for (const file of files) {
      attachments.push(await client.uploadAttachment(selectedId, file));
    }

    const mentions = parseMentions(text, {
      knownUsers: [
        ...people.map((p) => ({ userId: p.userId, displayName: p.displayName })),
        { userId: client.me.userId, displayName: client.me.displayName },
      ],
    });

    await client.send(selectedId, {
      text,
      mentions: mentions.length ? mentions : undefined,
      attachments: attachments.length ? attachments : undefined,
    });

    // Everything past this point is presentation. The message is already
    // delivered, so a failure refreshing the view must NOT be reported as a
    // failed send - doing that is what left text sitting in the composer
    // after a successful send.
    void (async () => {
      try {
        await loadMessages(client, selectedId);
        await refresh(client);
      } catch (err) {
        console.warn("[secure-chat] refresh after send failed", err);
      }
    })();
  };

  const handleDownload = async (attachment: AttachmentManifest) => {
    if (!client) return;
    saveBlob(await client.downloadAttachment(attachment), attachment.name);
  };

  const handleDelete = async (message: DecryptedMessage) => {
    if (!client || !selectedId) return;
    if (!window.confirm("Delete this message for everyone? The content is removed from the server.")) {
      return;
    }
    await client.deleteMessage(selectedId, message.id, message.body.attachments);
    await loadMessages(client, selectedId);
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
        `Deleted ${report.pagesRemoved} page(s) and ` +
          `${report.attachmentsRemoved + report.chunksSwept} attachment record(s).`
      );
      await refresh(client);
    } catch (err) {
      console.error("[secure-chat] delete failed", err);
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
      void refresh(client).catch((err) => console.warn("[secure-chat] refresh", err));
    } catch (err) {
      // Shown INSIDE the dialog - the header label is behind the modal, so
      // an error there reads as a dead click.
      console.error("[secure-chat] open direct failed", err);
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
      void refresh(client).catch((err) => console.warn("[secure-chat] refresh", err));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------------------------------------------- */
  /* render                                                           */
  /* ---------------------------------------------------------------- */

  if (phase === "loading") return <div className="sc-empty">Loading Secure Chat...</div>;

  if (phase === "error") {
    return (
      <div className="sc-center">
        <div className="sc-card">
          <h2>Secure Chat could not start</h2>
          <div className="sc-error">{error}</div>
        </div>
      </div>
    );
  }

  const selected = conversations.find((c) => c.id === selectedId);

  return (
    <div className="sc-app">
      <header className="sc-topbar">
        <span className="sc-title">Secure Chat</span>
        <span className="sc-conv-sub">not encrypted</span>
        <span className="sc-spacer" />
        {error && <span className="sc-error" style={{ margin: 0 }}>{error}</span>}
        {!error && deleteReport && (
          <span className="sc-conv-sub" style={{ margin: 0 }}>{deleteReport}</span>
        )}
        <Bell
          count={unread.total}
          onClick={() => {
            const first = unread.active[0];
            if (first) setSelectedId(first.convId);
          }}
        />
        <button
          onClick={() => {
            setError(undefined);
            setDialog("delete");
          }}
          disabled={!selected}
          title="Delete this conversation from the server, for everyone"
        >
          Delete
        </button>
      </header>

      <ConversationList
        items={conversations}
        selectedId={selectedId}
        nameOf={client!.nameOf}
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
      />

      <main className="sc-main">
        {selected ? (
          <>
            <MessageList
              messages={messages}
              myUserId={client?.me.userId ?? ""}
              onDownload={handleDownload}
              onDelete={(m) => void handleDelete(m)}
            />
            <Composer people={people} onSend={handleSend} />
          </>
        ) : (
          <div className="sc-empty">Pick a conversation, or start a new one.</div>
        )}
      </main>

      {dialog === "dm" && (
        <Modal title="New direct message" onClose={() => setDialog(undefined)}>
          {error && <div className="sc-error">{error}</div>}
          {busy && <div className="sc-hint">Opening conversation...</div>}
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
        <Modal title="New channel" onClose={() => setDialog(undefined)}>
          {error && <div className="sc-error">{error}</div>}
          <div className="sc-field">
            <label htmlFor="sc-channel">Channel name</label>
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
          <div className="sc-row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy || !channelName.trim()} onClick={() => void createChannel()}>
              Create
            </button>
            <button onClick={() => setDialog(undefined)}>Cancel</button>
          </div>
        </Modal>
      )}

      {dialog === "delete" && selected && (
        <Modal title="Delete this conversation?" onClose={() => setDialog(undefined)}>
          {error && <div className="sc-error">{error}</div>}
          <p>
            <strong>{selected.title}</strong> and everything in it will be removed from the
            server: every message, every attachment, and the conversation record itself.
          </p>
          <p>
            This is not just for you. The documents are shared by the whole conversation, so
            all {selected.members.length} member(s) lose it. It cannot be undone, and messages
            already read or downloaded by others are of course still theirs.
          </p>
          <p className="sc-hint">
            Azure DevOps backups may still contain the ciphertext until they age out.
          </p>
          <div className="sc-row" style={{ marginTop: 12 }}>
            <button
              className="primary"
              style={{ background: "var(--sc-danger)", borderColor: "var(--sc-danger)" }}
              disabled={busy}
              onClick={() => void deleteConversation()}
            >
              {busy ? "Deleting..." : "Delete for everyone"}
            </button>
            <button disabled={busy} onClick={() => setDialog(undefined)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

const container = document.getElementById("root");
if (container) createRoot(container).render(<App />);
