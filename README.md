# Secure Chat for Azure DevOps

An end-to-end encrypted chat extension for Azure DevOps Server and Azure DevOps
Services. Direct messages, channels, encrypted file sharing, live references to
work items / pull requests / commits, and an unread badge — with no backend
service of its own.

Everything is stored in Azure DevOps' built-in **Extension Data Service**, which
is what makes an air-gapped, offline install possible: install the `.vsix` and
you are done.

```
┌──────────────────────────── browser ────────────────────────────┐
│  Hub iframe                                                     │
│    React UI  ──►  ChatClient  ──►  crypto (WebCrypto)           │
│                        │                                        │
│                        ▼                                        │
│                  Store (typed wrapper)                          │
└────────────────────────┼────────────────────────────────────────┘
                         │ ciphertext only
                         ▼
        Azure DevOps Extension Data Service (your collection)
```

## Status

Working prototype. Every cryptographic primitive is covered by round-trip and
negative tests plus a cross-backend interop suite (`npm test`, 35 tests). It
has **not** had an external security
audit. Read [docs/02-crypto-design.md](docs/02-crypto-design.md) before trusting
it with anything that matters.

## Features

| Area | What it does |
| --- | --- |
| Messaging | 1:1 direct messages, multi-member channels, encrypted channel titles. Zero-setup: keys auto-generated, recovery automatic |
| Encryption | AES-256-GCM bodies, per-conversation keys, ECDH P-256 + HKDF key wrapping, ECDSA sender signatures |
| Transport | Works on HTTPS (WebCrypto) and plain HTTP (bundled `@noble` fallback), byte-identical on the wire so both interoperate |
| Files | Chunked client-side encryption, per-chunk position binding, SHA-256 integrity check on download |
| References | `#123` work item, `!123` pull request, bare sha commit, `@Name` user, pasted Azure DevOps URLs |
| Notifications | Bell + count in the hub, dashboard widget, opt-in desktop notifications that never carry message text |
| Integration | "Discuss in Secure Chat" on work item toolbar, backlog rows, query results, commit menus |
| Trust | Trust-on-first-use with automatic key re-issue; Signal-style safety numbers available for out-of-band checks |
| Membership | Adding or removing a member rotates the conversation key so history and future stay separated |
| Modes | Automatic per-conversation e2ee vs clear: conversations with members who never opened chat run unencrypted (labelled) and upgrade themselves |

## Quick start (development)

```bash
npm install
npm run icons
npm test
npm run build
```

Package a `.vsix`:

```bash
npx tfx extension create --manifest-globs azure-devops-extension.json --publisher YOUR_PUBLISHER --output-path ./bin
```

Then follow [docs/06-offline-install.md](docs/06-offline-install.md) to install it
without internet access.

## Requirements

- Azure DevOps Services, or Azure DevOps Server 2020 / 2022 / 2025
- **HTTP and HTTPS both work.** On HTTPS the extension uses WebCrypto. On plain
  HTTP, where `crypto.subtle` does not exist, it falls back to bundled
  `@noble` implementations that produce byte-identical output, so HTTP and
  HTTPS users interoperate. HTTP is a real downgrade — no transport integrity,
  keys stored as raw bytes, no desktop notifications — and the hub says so in
  its header. Read [docs/02-crypto-design.md §2.12](docs/02-crypto-design.md)
  before choosing it
- Node 18+ to build (developed on Node 24)

## Documentation

| Document | Contents |
| --- | --- |
| [01-architecture.md](docs/01-architecture.md) | Module map, contribution points, runtime flow |
| [02-crypto-design.md](docs/02-crypto-design.md) | Threat model, key hierarchy, what is and is not protected |
| [03-data-model.md](docs/03-data-model.md) | Every stored document, id budgets, paging and quota maths |
| [04-api-reference.md](docs/04-api-reference.md) | Public surface of every core module |
| [05-build-and-package.md](docs/05-build-and-package.md) | Toolchain, scripts, publisher setup, versioning |
| [06-offline-install.md](docs/06-offline-install.md) | Air-gapped install, update and rollback, step by step |
| [07-roadmap-rnd.md](docs/07-roadmap-rnd.md) | Researched feature backlog with design notes and effort |
| [08-operations.md](docs/08-operations.md) | Limits, garbage collection, troubleshooting, key recovery |

## Repository layout

```
azure-devops-extension.json   extension manifest (contributions, scopes)
overview.md                   marketplace details page
src/core/                     crypto, storage, conversations, messages, files
src/Hub/                      the chat page
src/Widget/                   dashboard unread widget
src/Actions/                  "Discuss in Secure Chat" menu handlers
scripts/make_icons.py         dependency-free PNG icon generator
tests/                        node:test suites for crypto and the parser
docs/                         the documents listed above
```

## Licence

MIT. See the notes in [docs/02-crypto-design.md](docs/02-crypto-design.md) about
what "no warranty" means for a cryptographic tool.
