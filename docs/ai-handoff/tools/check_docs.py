#!/usr/bin/env python3
"""
Sanity-check docs/ai-handoff against the repository.  Python 3, standard library only.

    python docs/ai-handoff/tools/check_docs.py

Checks (exit 1 if any fails):
  1. every backticked file-like token (*.ts, *.md, *.json, ...) resolves to a real file
     (bare names are resolved by basename anywhere in the repo; a few files the docs
     deliberately describe as REMOVED are whitelisted in EXPECTED_ABSENT);
  2. every backticked function/constant/type name appears somewhere in src/, tests/,
     scripts/, tools/, the manifest or webpack.config.js (names that are only examples
     are whitelisted in NOT_SYMBOLS);
  3. every `NN_` document cross-reference points at a real numbered document;
  4. every KI-nn mentioned anywhere is defined in 13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md;
  5. every Mermaid block is multi-line and has no literal backslash-n (use <br/>).

It proves references exist, NOT that the prose is true. Facts still need reading the code.
Add new deliberate exceptions to the two sets below rather than weakening the checks.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DOCS = sorted((ROOT / "docs" / "ai-handoff").glob("*.md"))
EXT = (".ts", ".tsx", ".js", ".cjs", ".mjs", ".json", ".md", ".css", ".html", ".py", ".png", ".vsix", ".sh")
SKIP_DIRS = {"node_modules", ".git", "dist"}

# Files the docs mention precisely because they no longer exist, or are generated names.
EXPECTED_ABSENT = {"keystore.ts", "keyring.ts", "interop.test.mjs", "02-security-model.md",
                   "hub.1a2b3c4d.js", "hub.js", "widget.js", "actions.js"}
# Backticked words that are not code symbols, or hypothetical names used in worked examples.
NOT_SYMBOLS = {"FEAT", "FUZZ", "INT", "MENT", "FIXME", "HACK", "TODO", "XXX", "LICENSE", "PATH",
               "UnicodeEncodeError", "MAINTENANCE", "VALIDATION_LOG", "GATE", "PASSED", "NOT",
               "TESTED", "UNKNOWN", "CONFIRMED", "INFERRED", "pinMessage"}

by_base = {}
for p in ROOT.rglob("*"):
    if p.is_file() and not (set(p.relative_to(ROOT).parts) & SKIP_DIRS):
        by_base.setdefault(p.name, []).append(p.relative_to(ROOT).as_posix())

blob = ""
for base in ("src", "tests", "scripts", "docs/ai-handoff/tools"):
    for p in (ROOT / base).rglob("*"):
        if p.is_file() and "build" not in p.parts:
            blob += p.read_text(encoding="utf-8", errors="ignore") + "\n"
for extra in ("azure-devops-extension.json", "webpack.config.js"):
    blob += (ROOT / extra).read_text(encoding="utf-8")

token = re.compile(r"`([^`\n]+)`")
problems, checked, symbols = [], 0, {}
for doc in DOCS:
    in_fence = False
    for n, line in enumerate(doc.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for m in token.finditer(line):
            t = re.sub(r":\d+(?:-\d+)?$", "", m.group(1).strip())
            if t.lower().endswith(EXT) and not any(c in t for c in " *<>{}$|()=\"'"):
                checked += 1
                name = t.rsplit("/", 1)[-1]
                if name in EXPECTED_ABSENT or t.startswith(("dist/", "bin/", "extension/")) or t.endswith(".vsix"):
                    continue
                if (ROOT / t).exists() or (ROOT / "docs/ai-handoff" / t).exists():
                    continue
                if "/" not in t and name in by_base:
                    continue
                if "/" in t and any(c.endswith(t) for c in by_base.get(name, [])):
                    continue
                problems.append(f"{doc.name}:{n}: file not found: {t}")
            sym = (re.fullmatch(r"(?:[A-Za-z_]\w*\.)?\.?([A-Za-z_]\w*)\(.*?\)", t)
                   or re.fullmatch(r"([A-Z][A-Z0-9_]{3,})", t)
                   or re.fullmatch(r"([A-Z][A-Za-z0-9]+)", t))
            if sym:
                symbols.setdefault(sym.group(1), f"{doc.name}:{n}")

for name, where in sorted(symbols.items()):
    if name not in NOT_SYMBOLS and not re.search(r"\b" + re.escape(name) + r"\b", blob):
        problems.append(f"{where}: symbol not found in code: {name}")

prefixes = {p.name.split("_")[0] for p in DOCS if p.name[0].isdigit()}
ki_text = (ROOT / "docs/ai-handoff/13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md").read_text(encoding="utf-8")
defined_ki = set(re.findall(r"KI-(\d\d)\b", ki_text))
backslash_n = chr(92) + "n"
for doc in DOCS:
    text = doc.read_text(encoding="utf-8")
    for n, line in enumerate(text.splitlines(), 1):
        for m in re.finditer(r"`(\d\d)_`", line):
            if m.group(1) not in prefixes:
                problems.append(f"{doc.name}:{n}: dangling document reference {m.group(0)}")
        for ki in re.findall(r"KI-(\d\d)\b", line):
            if ki not in defined_ki:
                problems.append(f"{doc.name}:{n}: KI-{ki} is not defined in 13_")
    for m in re.finditer(r"```mermaid\n(.*?)```", text, re.S):
        if m.group(1).count("\n") < 4 or backslash_n in m.group(1):
            problems.append(f"{doc.name}: suspicious mermaid block (single line or literal backslash-n)")

print(f"{len(DOCS)} docs, {checked} file-like tokens, {len(symbols)} symbol tokens, {len(defined_ki)} KI ids defined")
if problems:
    print("PROBLEMS:")
    print("\n".join(problems))
    sys.exit(1)
print("OK: all references resolve")
