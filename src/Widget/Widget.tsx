/**
 * Widget.tsx - dashboard widget carrying the unread badge.
 *
 * Azure DevOps has no extension point on the global header, so a badge that
 * follows you around every page is not something an extension can build. A
 * dashboard widget is the closest supported surface: pin it to the team
 * dashboard and the unread count is visible without opening the hub.
 *
 * The widget deliberately does *not* touch key material at all. Unread counts
 * come from `messageCount` on the conversation documents, which is plaintext
 * metadata, so the widget renders correctly without decrypting anything. It
 * shows counts and sender names, never message content.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";
import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  IHostNavigationService,
} from "azure-devops-extension-api";

import "../styles.css";

import { getStore } from "@core/storage";
import { ReadState, type UnreadSummary } from "@core/notifications";
import { COLLECTIONS, type ConversationDoc, type ProfileDoc } from "@core/model";

interface WidgetStatus {
  state: string;
}

const StatusOk: WidgetStatus = { state: "Success" };

const Widget: React.FC<{ summary?: UnreadSummary; names: Map<string, string>; error?: string }> = ({
  summary,
  names,
  error,
}) => {
  const total = summary?.total ?? 0;

  const openHub = async () => {
    const nav = await SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService);
    // The hub group id is `{publisher}.{extension}.chat-hub-group`; the SDK
    // gives us the fully qualified contribution id at runtime.
    const contributionId = SDK.getExtensionContext().id;
    nav.navigate(`${window.location.origin}${window.location.pathname}`.replace(/\/_dashboards.*$/, "") +
      `/_apps/hub/${contributionId}.chat-hub`);
  };

  return (
    <div className="sc-widget">
      <div className="sc-widget-head">
        <span aria-hidden="true">{total > 0 ? "🔔" : "🔕"}</span>
        <span>Secure Chat</span>
      </div>
      {error ? (
        <div className="sc-error">{error}</div>
      ) : (
        <>
          <div className="sc-widget-count">{total}</div>
          <div className="sc-widget-list">
            {total === 0
              ? "You are all caught up."
              : summary!.active
                  .slice(0, 3)
                  .map((a) => `${names.get(a.lastSenderId ?? "") ?? "Someone"} (${a.count})`)
                  .join(", ")}
          </div>
        </>
      )}
      <button className="ghost" style={{ alignSelf: "flex-start" }} onClick={() => void openHub()}>
        Open chat
      </button>
    </div>
  );
};

async function computeSummary(): Promise<{ summary: UnreadSummary; names: Map<string, string> }> {
  const store = await getStore();
  const readState = new ReadState(store);

  const me = SDK.getUser().id;
  const all = await store.list<ConversationDoc>(COLLECTIONS.conversations);
  const mine = all.filter((c) => c.members.includes(me));
  const summary = await readState.summarise(mine, me);

  const names = new Map<string, string>();
  for (const profile of await store.list<ProfileDoc>(COLLECTIONS.profiles)) {
    names.set(profile.userId, profile.displayName);
  }

  return { summary, names };
}

let render: (node: React.ReactElement) => void = () => undefined;

void (async () => {
  await SDK.init({ loaded: false, applyTheme: true });
  await SDK.ready();

  const container = document.getElementById("root");
  if (container) {
    const root = createRoot(container);
    render = (node) => root.render(node);
  }

  const load = async (): Promise<WidgetStatus> => {
    try {
      const { summary, names } = await computeSummary();
      render(<Widget summary={summary} names={names} />);
    } catch (err) {
      render(
        <Widget names={new Map()} error={err instanceof Error ? err.message : String(err)} />
      );
    }
    return StatusOk;
  };

  SDK.register("chat-unread-widget", { load, reload: load });
  SDK.notifyLoadSucceeded();
})();
