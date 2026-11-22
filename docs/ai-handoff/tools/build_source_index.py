#!/usr/bin/env python3
"""
Regenerate docs/ai-handoff/source-index.json from the graphify graph.

Usage (from the repository root, Python 3 standard library only):

    graphify update .                              # refresh graphify-out/graph.json (code only, no LLM)
    python docs/ai-handoff/tools/build_source_index.py

What is hand-written here (and must be edited when the architecture changes):
  FILES    - one entry per source file: area, purpose, tests that cover it, docs
  SYMBOLS  - the symbols worth jumping to directly
  TASKS    - task -> where to start

What is generated: the `line` of every symbol, read from graphify-out/graph.json,
and the commit the graph was built from. Line numbers drift whenever a file is
edited; treat them as hints and fall back to `grep -n "<symbol>" <file>`.

The script fails loudly if a listed symbol is missing from the graph, which is
how stale entries get noticed after a rename.
"""

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GRAPH = ROOT / "graphify-out" / "graph.json"
OUT = ROOT / "docs" / "ai-handoff" / "source-index.json"

# --------------------------------------------------------------------------
# hand-written: files
# --------------------------------------------------------------------------
FILES = {
    "src/core/model.ts": {
        "area": "data",
        "purpose": "Every persisted document shape, storage namespace, collection names and tuning constants.",
        "tests": ["tests/integration.test.mjs", "tests/features.test.mjs"],
        "docs": ["06_DATA_AND_DATABASE.md"],
    },
    "src/core/storage.ts": {
        "area": "data",
        "purpose": "Typed wrapper over the Azure DevOps Extension Data Service: timeouts, etag retry (mutate), 50-char id guard.",
        "tests": ["tests/integration.test.mjs"],
        "docs": ["06_DATA_AND_DATABASE.md"],
    },
    "src/core/client.ts": {
        "area": "facade",
        "purpose": "ChatClient: the only object the UI talks to. Startup, names, polling, search, reactions, typing, presence, deletion.",
        "tests": ["tests/integration.test.mjs", "tests/features.test.mjs"],
        "docs": ["05_COMPONENT_REFERENCE.md", "03_ARCHITECTURE.md"],
    },
    "src/core/conversations.ts": {
        "area": "domain",
        "purpose": "Conversation lifecycle: DM/channel/subject creation, membership, rename, typing flag, list/view.",
        "tests": ["tests/integration.test.mjs", "tests/features.test.mjs"],
        "docs": ["05_COMPONENT_REFERENCE.md"],
    },
    "src/core/messages.ts": {
        "area": "domain",
        "purpose": "Two-step append, paged reads, search, edit, delete (tombstone), reactions.",
        "tests": ["tests/integration.test.mjs", "tests/features.test.mjs"],
        "docs": ["05_COMPONENT_REFERENCE.md", "06_DATA_AND_DATABASE.md"],
    },
    "src/core/files.ts": {
        "area": "domain",
        "purpose": "Attachments split into 64 KiB base64 chunk documents; concurrent IO; SHA-256 check; orphan sweep.",
        "tests": ["tests/integration.test.mjs", "tests/features.test.mjs"],
        "docs": ["06_DATA_AND_DATABASE.md"],
    },
    "src/core/notifications.ts": {
        "area": "domain",
        "purpose": "ReadState (unread cursors) and Poller (slow full-list tick plus fast single-conversation tick); desktop toasts.",
        "tests": ["tests/features.test.mjs"],
        "docs": ["03_ARCHITECTURE.md"],
    },
    "src/core/devops.ts": {
        "area": "integration",
        "purpose": "The only module calling Azure DevOps REST/SDK services: people directory, identity search, mention resolution, hub URLs.",
        "tests": ["tests/integration.test.mjs"],
        "docs": ["07_API_AND_INTEGRATIONS.md"],
    },
    "src/core/mentions.ts": {
        "area": "domain",
        "purpose": "Pure parser for #id, !id, sha, @name, URLs; segment(); memoised resolver cache.",
        "tests": ["tests/mentions.test.mjs"],
        "docs": ["07_API_AND_INTEGRATIONS.md"],
    },
    "src/core/crypto.ts": {
        "area": "util",
        "purpose": "Misnamed: NO encryption. base64, SHA-256 (@noble/hashes), random ids, deterministic hash ids.",
        "tests": ["tests/integration.test.mjs"],
        "docs": ["11_SECURITY_AND_CONFIGURATION.md"],
    },
    "src/core/i18n.ts": {
        "area": "ui-support",
        "purpose": "English and Persian UI strings, translator(), digits, direction (applyLanguage), language guess.",
        "tests": [],
        "docs": ["12_TASK_PLAYBOOKS.md"],
    },
    "src/Hub/Hub.tsx": {
        "area": "ui",
        "purpose": "Hub page. App component owns ALL state, boots the client, wires polling, search, dialogs, send/edit/react/delete.",
        "tests": [],
        "docs": ["03_ARCHITECTURE.md", "05_COMPONENT_REFERENCE.md"],
    },
    "src/Hub/components.tsx": {
        "area": "ui",
        "purpose": "Presentational components (list, messages, composer, dialogs, picker). No storage access; strings via LangContext.",
        "tests": [],
        "docs": ["05_COMPONENT_REFERENCE.md"],
    },
    "src/Widget/Widget.tsx": {
        "area": "ui",
        "purpose": "Dashboard widget: unread count from conversation docs + user read cursor. English only, no theme sync.",
        "tests": [],
        "docs": ["03_ARCHITECTURE.md"],
    },
    "src/Actions/Actions.ts": {
        "area": "ui",
        "purpose": "Hidden-frame handlers for 'Discuss in ...' menu items: park target in user data, navigate to hub.",
        "tests": [],
        "docs": ["03_ARCHITECTURE.md"],
    },
    "src/styles.css": {
        "area": "ui",
        "purpose": "All CSS: light and dark palettes, Telegram-style layout, logical properties for RTL, responsive breakpoints.",
        "tests": [],
        "docs": ["12_TASK_PLAYBOOKS.md"],
    },
    "azure-devops-extension.json": {
        "area": "packaging",
        "purpose": "Extension manifest: id, publisher (placeholder), scopes, 5 contributions, file roots.",
        "tests": [],
        "docs": ["10_DEPLOYMENT_AND_OPERATIONS.md", "11_SECURITY_AND_CONFIGURATION.md"],
    },
    "webpack.config.js": {
        "area": "build",
        "purpose": "Three bundles (hub, widget, actions) with content-hashed names, HTML entries, @core alias.",
        "tests": [],
        "docs": ["08_DEVELOPMENT_SETUP.md"],
    },
    "tests/harness/index.cjs": {
        "area": "test",
        "purpose": "In-process Azure DevOps emulator: module interception, etag-correct document store, fault injection, per-collection call counters.",
        "tests": [],
        "docs": ["09_TESTING_AND_DEBUGGING.md"],
    },
    "overview.md": {
        "area": "docs",
        "purpose": "Marketplace details page AND the in-product user manual (English + Persian). Shipped inside the .vsix.",
        "tests": [],
        "docs": ["12_TASK_PLAYBOOKS.md"],
    },
}

# --------------------------------------------------------------------------
# hand-written: symbols  (file, graph label)  -> the label forms graphify uses:
#   classes/consts/interfaces: "Name"   functions: "name()"   methods: ".name()"
# --------------------------------------------------------------------------
SYMBOLS = [
    # model
    ("src/core/model.ts", "NAMESPACE"), ("src/core/model.ts", "COLLECTIONS"),
    ("src/core/model.ts", "PAGE_SIZE"), ("src/core/model.ts", "CHUNK_BYTES"),
    ("src/core/model.ts", "MAX_ATTACHMENT_BYTES"), ("src/core/model.ts", "CHUNK_CONCURRENCY"),
    ("src/core/model.ts", "TYPING_TTL_MS"), ("src/core/model.ts", "REACTION_EMOJI"),
    ("src/core/model.ts", "ProfileDoc"), ("src/core/model.ts", "ConversationDoc"),
    ("src/core/model.ts", "PageDoc"), ("src/core/model.ts", "StoredMessage"),
    ("src/core/model.ts", "BlobChunkDoc"), ("src/core/model.ts", "ReadStateDoc"),
    ("src/core/model.ts", "MessageBody"), ("src/core/model.ts", "AttachmentManifest"),
    ("src/core/model.ts", "DecryptedMessage"),
    # storage
    ("src/core/storage.ts", "Store"), ("src/core/storage.ts", ".mutate()"),
    ("src/core/storage.ts", "isConflict()"), ("src/core/storage.ts", "getStore()"),
    ("src/core/storage.ts", "assertDocId()"),
    # crypto (hashing/encoding only)
    ("src/core/crypto.ts", "hashId()"), ("src/core/crypto.ts", "randomId()"),
    ("src/core/crypto.ts", "sha256()"),
    # conversations
    ("src/core/conversations.ts", "Conversations"), ("src/core/conversations.ts", "dmId()"),
    ("src/core/conversations.ts", "subjectId()"), ("src/core/conversations.ts", "activeTypers()"),
    ("src/core/conversations.ts", ".openDirect()"), ("src/core/conversations.ts", ".mine()"),
    ("src/core/conversations.ts", ".setTyping()"),
    # messages
    ("src/core/messages.ts", "Messages"), ("src/core/messages.ts", ".send()"),
    ("src/core/messages.ts", ".recent()"), ("src/core/messages.ts", ".search()"),
    ("src/core/messages.ts", ".react()"), ("src/core/messages.ts", ".edit()"),
    ("src/core/messages.ts", ".remove()"), ("src/core/messages.ts", ".present()"),
    ("src/core/messages.ts", ".findPage()"), ("src/core/messages.ts", "previewOf()"),
    # files
    ("src/core/files.ts", "Files"), ("src/core/files.ts", "pooled()"),
    ("src/core/files.ts", ".upload()"), ("src/core/files.ts", ".download()"),
    ("src/core/files.ts", ".collectGarbage()"),
    # notifications
    ("src/core/notifications.ts", "ReadState"), ("src/core/notifications.ts", ".markRead()"),
    ("src/core/notifications.ts", "Poller"), ("src/core/notifications.ts", ".focusCycle()"),
    ("src/core/notifications.ts", "notifyNewMessages()"),
    # devops
    ("src/core/devops.ts", "looksLikeIdentityId()"), ("src/core/devops.ts", "collectionMembers()"),
    ("src/core/devops.ts", "loadDirectory()"), ("src/core/devops.ts", "searchPeople()"),
    ("src/core/devops.ts", "resolveMention()"), ("src/core/devops.ts", "hostBaseUrl()"),
    ("src/core/devops.ts", "hubUrl()"), ("src/core/devops.ts", "navigateToHub()"),
    ("src/core/devops.ts", "withTimeout()"),
    # mentions
    ("src/core/mentions.ts", "parseMentions()"), ("src/core/mentions.ts", "segment"),
    # client
    ("src/core/client.ts", "ChatClient"), ("src/core/client.ts", "bootstrap()"),
    ("src/core/client.ts", "EXTENSION_VERSION"), ("src/core/client.ts", ".init()"),
    ("src/core/client.ts", ".publishProfile()"), ("src/core/client.ts", ".nameOf()"),
    ("src/core/client.ts", ".deleteConversation()"), ("src/core/client.ts", ".sweepOrphanChunks()"),
    ("src/core/client.ts", ".startPolling()"), ("src/core/client.ts", ".searchMessages()"),
    ("src/core/client.ts", ".diagnose()"),
    # i18n
    ("src/core/i18n.ts", "translator()"), ("src/core/i18n.ts", "applyLanguage()"),
    ("src/core/i18n.ts", "EN"), ("src/core/i18n.ts", "FA"),
    # ui
    ("src/Hub/Hub.tsx", "App()"), ("src/Hub/Hub.tsx", "applyHostTheme()"),
    ("src/Hub/components.tsx", "MessageList()"), ("src/Hub/components.tsx", "Composer()"),
    ("src/Hub/components.tsx", "ConversationList()"), ("src/Hub/components.tsx", "Modal()"),
    ("src/Hub/components.tsx", "Confirm()"), ("src/Hub/components.tsx", "PeoplePicker()"),
    ("src/Widget/Widget.tsx", "computeSummary()"), ("src/Actions/Actions.ts", "park()"),
]

# --------------------------------------------------------------------------
# hand-written: task -> where to start
# --------------------------------------------------------------------------
TASKS = {
    "fix a send/receive bug": ["src/core/messages.ts", "src/core/client.ts", "tests/integration.test.mjs"],
    "change what is stored": ["src/core/model.ts", "src/core/storage.ts", "06_DATA_AND_DATABASE.md"],
    "add or change a UI string": ["src/core/i18n.ts", "src/Hub/components.tsx"],
    "change layout or colours": ["src/styles.css"],
    "change polling or unread logic": ["src/core/notifications.ts", "src/core/client.ts"],
    "change who appears in the people picker": ["src/core/devops.ts"],
    "change #/!/sha/@ parsing": ["src/core/mentions.ts", "tests/mentions.test.mjs"],
    "change attachments": ["src/core/files.ts", "src/core/model.ts"],
    "add a menu action": ["azure-devops-extension.json", "src/Actions/Actions.ts"],
    "package a release": ["azure-devops-extension.json", "10_DEPLOYMENT_AND_OPERATIONS.md"],
}


def commit_hash() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except Exception:
        return "unknown"


def main() -> int:
    if not GRAPH.exists():
        print(f"missing {GRAPH}. Run: graphify update .", file=sys.stderr)
        return 1

    graph = json.loads(GRAPH.read_text(encoding="utf-8"))
    by_key = {}
    for node in graph["nodes"]:
        sf = (node.get("source_file") or "").replace("\\", "/")
        by_key.setdefault((sf, node.get("label", "")), node)

    missing, symbols = [], []
    for file, label in SYMBOLS:
        node = by_key.get((file, label))
        if node is None:
            missing.append(f"{file} :: {label}")
            continue
        loc = str(node.get("source_location", ""))
        symbols.append({
            "symbol": label.strip(".").rstrip("()") if label.startswith(".") else label.rstrip("()"),
            "kind": "method" if label.startswith(".") else ("function" if label.endswith("()") else "type-or-const"),
            "file": file,
            "line": int(loc[1:]) if loc.startswith("L") and loc[1:].isdigit() else None,
        })

    for f in FILES:
        if not (ROOT / f).exists():
            missing.append(f"FILES entry does not exist: {f}")

    if missing:
        print("STALE ENTRIES - fix FILES/SYMBOLS in this script:", file=sys.stderr)
        for m in missing:
            print("  " + m, file=sys.stderr)
        return 2

    index = {
        "_note": "Generated by docs/ai-handoff/tools/build_source_index.py. Lines are hints; grep the symbol if they drifted.",
        "generated_on": date.today().isoformat(),
        "git_head": commit_hash(),
        "graph": {
            "nodes": len(graph["nodes"]),
            "edges": len(graph["links"]),
            "built_at_commit": graph.get("built_at_commit"),
        },
        "files": FILES,
        "symbols": sorted(symbols, key=lambda s: (s["file"], s["line"] or 0)),
        "tasks": TASKS,
    }
    OUT.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(FILES)} files, {len(symbols)} symbols")
    return 0


if __name__ == "__main__":
    sys.exit(main())
