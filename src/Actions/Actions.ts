/**
 * Actions.ts - the "Discuss in Team Chat" menu items.
 *
 * These run in a hidden frame with no UI, so they cannot render a
 * conversation themselves. Instead the action records the target in
 * user-scoped extension data and navigates to the hub, which picks it up on
 * load and opens (or creates) the matching conversation.
 */

import * as SDK from "azure-devops-extension-sdk";

import { getStore } from "@core/storage";
import type { ConversationSubject } from "@core/model";
import {
  firstCommitId,
  firstWorkItemId,
  navigateToHub,
  type CommitActionContext,
  type WorkItemActionContext,
} from "@core/devops";

const PENDING_SUBJECT_KEY = "pending-subject";

async function park(subject: ConversationSubject, title: string): Promise<void> {
  const store = await getStore();
  await store.setValue(PENDING_SUBJECT_KEY, { subject, title }, "user");

  await navigateToHub("chat-hub");
}

void (async () => {
  await SDK.init({ loaded: false });
  await SDK.ready();

  SDK.register("discuss-work-item", {
    execute: async (context: WorkItemActionContext) => {
      const id = firstWorkItemId(context);
      if (!id) return;
      await park({ type: "workitem", key: String(id) }, `Work item #${id}`);
    },
  });

  SDK.register("discuss-commit", {
    execute: async (context: CommitActionContext) => {
      const sha = firstCommitId(context);
      const repositoryId = context.repositoryId ?? context.gitRepository?.id;
      if (!sha) return;
      await park(
        { type: "commit", key: sha, repositoryId },
        `Commit ${sha.slice(0, 8)}`
      );
    },
  });

  SDK.notifyLoadSucceeded();
})();
