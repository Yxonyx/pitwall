#!/usr/bin/env python3
"""Fail the build if a secret or a permission bypass landed in the repo."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".git", "node_modules", "dist", "data", "research_notes", "reports", "coverage", ".pitwall"}
SKIP_FILES = {"BESZELGETES.md"}
TEXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".html", ".md", ".yml", ".yaml", ".json", ".py", ".webmanifest"}
SECRET = re.compile(
    r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|sk-[A-Za-z0-9]{20,}"
)
BYPASS = ("dangerously-skip-permissions", "bypassPermissions")


def main() -> int:
    failed = False
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts) or path.name in SKIP_FILES:
            continue
        if path.suffix not in TEXT:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        relative = path.relative_to(ROOT).as_posix()
        if SECRET.search(text):
            print(f"secret-looking text in {relative}")
            failed = True
        if "src" not in path.parts or path.suffix not in {".ts", ".js", ".mjs"} or path.name.endswith(".test.ts"):
            continue
        for flag in BYPASS:
            if flag in text:
                print(f"{flag} in {relative}")
                failed = True
    if failed:
        return 1
    print("guard: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
