/**
 * components.tsx - presentational pieces of the hub.
 *
 * No component here touches crypto or storage directly; everything arrives
 * through props from Hub.tsx, which owns the ChatClient.
 */

import * as React from "react";

import type { Person } from "@core/client";
import type { DirectoryResult as DirectoryStatus } from "@core/devops";
import { memoiseResolver, segment, type ResolvedRef } from "@core/mentions";
import { resolveMention, navigateTo } from "@core/devops";
import type {
  AttachmentManifest,
  ConversationView,
  DecryptedMessage,
  Mention,
} from "@core/model";

const resolver = memoiseResolver(resolveMention);

/* ------------------------------------------------------------------ */
/* small pieces                                                        */
/* ------------------------------------------------------------------ */

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

export const Avatar: React.FC<{ name: string }> = ({ name }) => (
  <span className="sc-avatar" aria-hidden="true">
    {initials(name)}
  </span>
);

export const Bell: React.FC<{ count: number; onClick?: () => void }> = ({ count, onClick }) => (
  <button
    className={`sc-bell${count > 0 ? " has-unread" : ""}`}
    onClick={onClick}
    title={count > 0 ? `${count} unread message${count === 1 ? "" : "s"}` : "No unread messages"}
    aria-label={count > 0 ? `${count} unread messages` : "No unread messages"}
  >
    <span aria-hidden="true">{count > 0 ? "🔔" : "🔕"}</span>
    {count > 0 && <span className="sc-badge">{count > 99 ? "99+" : count}</span>}
  </button>
);

const formatBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const formatDay = (iso: string): string => new Date(iso).toLocaleDateString();

/* ------------------------------------------------------------------ */
/* conversation list                                                   */
/* ------------------------------------------------------------------ */

export const ConversationList: React.FC<{
  items: ConversationView[];
  selectedId?: string;
  nameOf: (userId: string) => string;
  onSelect: (id: string) => void;
  onNewDirect: () => void;
  onNewChannel: () => void;
}> = ({ items, selectedId, nameOf, onSelect, onNewDirect, onNewChannel }) => (
  <nav className="sc-sidebar" aria-label="Conversations">
    <div className="sc-list-actions">
      <button onClick={onNewDirect}>New message</button>
      <button onClick={onNewChannel}>New channel</button>
    </div>
    {items.length === 0 && <div className="sc-empty">No conversations yet.</div>}
    {items.map((item) => (
      <button
        key={item.id}
        className={`sc-conv${item.id === selectedId ? " selected" : ""}${item.unread ? " unread" : ""}`}
        onClick={() => onSelect(item.id)}
      >
        <Avatar name={item.title} />
        <span className="sc-conv-body">
          <span className="sc-conv-title">{item.title}</span>
          <span className="sc-conv-sub">
            {item.kind === "dm"
              ? "Direct message"
              : item.subject
                ? `${item.subject.type} ${item.subject.key}`
                : `${item.members.length} members`}
            {item.lastSenderId ? ` · ${nameOf(item.lastSenderId)}` : ""}
          </span>
        </span>
        {item.unread > 0 && <span className="sc-pill">{item.unread > 99 ? "99+" : item.unread}</span>}
      </button>
    ))}
  </nav>
);

/* ------------------------------------------------------------------ */
/* mentions                                                            */
/* ------------------------------------------------------------------ */

const KIND_SIGIL: Record<Mention["kind"], string> = {
  workitem: "#",
  pullrequest: "!",
  commit: "⌥",
  user: "@",
  build: "▶",
  url: "🔗",
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
      <span className="sc-chip-kind">
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
  onDownload: (a: AttachmentManifest) => Promise<void>;
}> = ({ attachment, onDownload }) => {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();

  return (
    <div className="sc-attachment">
      <span aria-hidden="true">📎</span>
      <span className="sc-attachment-meta">
        <span className="sc-attachment-name">{attachment.name}</span>
        <span>
          {formatBytes(attachment.size)} · {attachment.chunks} chunk
          {attachment.chunks === 1 ? "" : "s"}
        </span>
        {error && <span className="sc-error">{error}</span>}
      </span>
      <button
        disabled={busy}
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
        {busy ? "Downloading..." : "Download"}
      </button>
    </div>
  );
};

export const MessageList: React.FC<{
  messages: DecryptedMessage[];
  myUserId: string;
  onDownload: (a: AttachmentManifest) => Promise<void>;
  onDelete: (m: DecryptedMessage) => void;
}> = ({ messages, myUserId, onDownload, onDelete }) => {
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  let lastDay = "";
  return (
    <div className="sc-messages">
      {messages.length === 0 && <div className="sc-empty">No messages yet. Say something.</div>}
      {messages.map((message) => {
        const day = formatDay(message.sentAt);
        const showDay = day !== lastDay;
        lastDay = day;
        const mentions = message.body.mentions ?? [];

        return (
          <React.Fragment key={message.id}>
            {showDay && <div className="sc-day">{day}</div>}
            <div className={`sc-msg${message.failed ? " failed" : ""}`}>
              <Avatar name={message.senderName} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="sc-msg-head">
                  <span className="sc-msg-author">{message.senderName}</span>
                  <span className="sc-msg-time">{formatTime(message.sentAt)}</span>
                  {message.body.editedAt && <span className="sc-msg-time">(edited)</span>}
                  {message.senderId === myUserId && !message.deleted && (
                    <button className="ghost sc-msg-time" onClick={() => onDelete(message)}>
                      delete
                    </button>
                  )}
                </div>

                {message.deleted ? (
                  <div className="sc-msg-text" style={{ opacity: 0.6, fontStyle: "italic" }}>
                    Message deleted
                  </div>
                ) : message.failed ? (
                  <div className="sc-msg-text">{message.failed}</div>
                ) : (
                  <div className="sc-msg-text">
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
                    onDownload={onDownload}
                  />
                ))}
              </div>
            </div>
          </React.Fragment>
        );
      })}
      <div ref={endRef} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* composer                                                            */
/* ------------------------------------------------------------------ */

export const Composer: React.FC<{
  people: Person[];
  disabled?: boolean;
  onSend: (text: string, files: File[]) => Promise<void>;
}> = ({ people, disabled, onSend }) => {
  const [text, setText] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const areaRef = React.useRef<HTMLTextAreaElement>(null);

  // Autocomplete for "@" only. Work item and commit tokens are matched at
  // send time, so there is nothing to suggest for them.
  const trailingMention = React.useMemo(() => {
    const match = /(?:^|[\s(])@([^\s@]{0,40})$/.exec(text);
    return match ? match[1] : undefined;
  }, [text]);

  const suggestions = React.useMemo(() => {
    if (trailingMention === undefined) return [];
    const needle = trailingMention.toLowerCase();
    return people.filter((p) => p.displayName.toLowerCase().includes(needle)).slice(0, 8);
  }, [trailingMention, people]);

  const applySuggestion = (person: Person) => {
    setText((current) => current.replace(/@([^\s@]{0,40})$/, `@${person.displayName} `));
    areaRef.current?.focus();
  };

  const submit = async () => {
    if (busy || disabled) return;
    if (!text.trim() && files.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSend(text.trim(), files);
      setText("");
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sc-composer">
      {suggestions.length > 0 && (
        <div className="sc-suggest">
          {suggestions.map((person) => (
            <button key={person.userId} onClick={() => applySuggestion(person)}>
              {person.displayName}
            </button>
          ))}
        </div>
      )}

      {error && <div className="sc-error">{error}</div>}

      {files.length > 0 && (
        <div className="sc-hint">
          Attaching: {files.map((f) => `${f.name} (${formatBytes(f.size)})`).join(", ")}{" "}
          <button className="ghost" onClick={() => setFiles([])}>
            clear
          </button>
        </div>
      )}

      <div className="sc-composer-row">
        <textarea
          ref={areaRef}
          rows={1}
          disabled={disabled || busy}
          placeholder="Message. #123 links a work item, !45 a pull request, a sha links a commit, @name mentions somebody."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <label className="sc-row" title="Attach an encrypted file">
          <input
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <span
            style={{
              border: "1px solid var(--sc-border)",
              borderRadius: "var(--sc-radius)",
              padding: "5px 10px",
              cursor: "pointer",
            }}
          >
            Attach
          </span>
        </label>
        <button className="primary" disabled={disabled || busy} onClick={() => void submit()}>
          {busy ? "Sending..." : "Send"}
        </button>
      </div>
      <div className="sc-hint">Enter sends, Shift+Enter adds a line.</div>
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
}) => (
  <div className="sc-modal-backdrop" onClick={onClose} role="dialog" aria-label={title}>
    <div className="sc-card" onClick={(e) => e.stopPropagation()}>
      <h2>{title}</h2>
      {children}
    </div>
  </div>
);

export const PeoplePicker: React.FC<{
  people: Person[];
  multi: boolean;
  selected: string[];
  status?: DirectoryStatus;
  onSearch?: (query: string) => Promise<Person[]>;
  onToggle: (userId: string) => void;
}> = ({ people, multi, selected, status, onSearch, onToggle }) => {
  const [filter, setFilter] = React.useState("");
  const [remote, setRemote] = React.useState<Person[]>([]);

  // Live search through the host identity service, debounced. This works
  // even when the bulk directory could not be enumerated at all.
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
    if (filter.trim().length >= 2 && onSearch) return `Nobody matching "${filter}".`;
    if (filter) return `Keep typing to search the whole directory.`;
    if (status?.error) return `The directory could not be read: ${status.error}`;
    if (status?.source === "none") return "The directory could not be read.";
    if (status?.source === "project") {
      return "Only this project could be listed; collection-wide listing was unavailable.";
    }
    return "No other people were found in this collection.";
  };

  return (
    <>
      <div className="sc-field">
        <input
          type="search"
          placeholder="Search people in this collection"
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
                style={{ width: "auto", pointerEvents: "none" }}
              />
            )}
            <Avatar name={person.displayName} />
            <span style={{ flex: 1, textAlign: "left" }}>{person.displayName}</span>
          </button>
        ))}
      </div>
    </>
  );
};

