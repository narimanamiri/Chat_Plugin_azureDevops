# Team Chat

Team chat that lives inside Azure DevOps, with no server of its own.

Messages are stored in Azure DevOps' built-in extension data store, so there
is nothing to deploy, nothing to connect to, and it works on an air-gapped
Azure DevOps Server.

## Messages are not encrypted

Earlier versions encrypted messages end to end. That is gone as of 0.7.0.

The cryptography worked; its key management did not. Keys had to live in the
browser, so every browser change, profile reset or reinstall produced a new
identity, and messages encrypted to the old one became unreadable. Recovery
depended on another member still holding a usable key and being online. In
practice that meant repeated lockouts.

So, plainly: **anyone who can read your project collection's extension data
can read every message.** That includes your Azure DevOps administrator, your
database administrator, anyone with a collection backup, and any colleague
willing to call the REST API. Treat it like a comment on a work item, not
like a private channel.

## What it does

- **Direct messages and channels** across the whole project collection
- **File sharing**, chunked so it fits the document store, with an integrity
  check on download
- **Rich references** - `#1234` a work item, `!1234` a pull request, a git sha
  a commit, `@Name` a person - resolved to live titles and clickable
- **Unread badge** in the hub, a dashboard widget, and optional desktop
  notifications
- **Discuss in Team Chat** on work items, backlog rows and commits
- **Delete** a conversation and everything in it, from the server

## Requirements

- Azure DevOps Services, or Azure DevOps Server 2020 or later
- HTTP or HTTPS - there is no longer any WebCrypto dependency
- A modern Chromium, Firefox or Safari browser
