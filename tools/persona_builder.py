#!/usr/bin/env python3
"""Builds persona.json — the file that controls Afroica AI's behavior.

The browser app never runs this script; it just reads persona.json at
startup. This is the "Python controls the AI" layer: edit your persona
here, on your own machine, and the change shows up next time the app
loads persona.json. No server, no runtime dependency on Python.

Usage:
    python tools/persona_builder.py            # interactive prompts
    python tools/persona_builder.py --show      # print the current persona.json
    python tools/persona_builder.py \\
        --user-name "David" \\
        --tone "warm, direct, a little playful" \\
        --expertise "African languages,software engineering,music" \\
        --instructions "Keep answers short unless I ask for detail."
"""

import argparse
import json
import sys
from pathlib import Path

PERSONA_PATH = Path(__file__).resolve().parent.parent / "persona.json"

DEFAULTS = {
    "ai_name": "Afroica AI",
    "user_name": "",
    "tone": "warm, clear, and concise",
    "expertise": [
        "African languages",
        "African cultures and history",
        "everyday practical topics",
    ],
    "instructions": "",
}


def load_current():
    if PERSONA_PATH.exists():
        with PERSONA_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        return {**DEFAULTS, **data}
    return dict(DEFAULTS)


def save(persona):
    with PERSONA_PATH.open("w", encoding="utf-8") as f:
        json.dump(persona, f, indent=2, ensure_ascii=False)
        f.write("\n")


def prompt(label, current):
    shown = current if isinstance(current, str) else ", ".join(current)
    raw = input(f"{label} [{shown}]: ").strip()
    return raw if raw else current


def run_interactive():
    persona = load_current()
    print(f"Editing {PERSONA_PATH}")
    print("Press Enter to keep the current value shown in [brackets].\n")

    persona["ai_name"] = prompt("AI's name", persona["ai_name"])
    persona["user_name"] = prompt("Your name (so the AI can address you)", persona["user_name"])
    persona["tone"] = prompt("Tone / personality", persona["tone"])

    expertise_raw = prompt(
        "Areas of expertise (comma-separated)", persona["expertise"]
    )
    if isinstance(expertise_raw, str):
        persona["expertise"] = [s.strip() for s in expertise_raw.split(",") if s.strip()]
    else:
        persona["expertise"] = expertise_raw

    persona["instructions"] = prompt(
        "Any extra behavior rules (free text, optional)", persona["instructions"]
    )

    save(persona)
    print(f"\nSaved. Reload the app in your browser to pick up the new persona.")


def run_from_args(args):
    persona = load_current()
    if args.ai_name is not None:
        persona["ai_name"] = args.ai_name
    if args.user_name is not None:
        persona["user_name"] = args.user_name
    if args.tone is not None:
        persona["tone"] = args.tone
    if args.expertise is not None:
        persona["expertise"] = [s.strip() for s in args.expertise.split(",") if s.strip()]
    if args.instructions is not None:
        persona["instructions"] = args.instructions
    save(persona)
    print(f"Saved {PERSONA_PATH}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--show", action="store_true", help="print the current persona.json and exit")
    parser.add_argument("--ai-name", dest="ai_name", help="what the assistant calls itself")
    parser.add_argument("--user-name", dest="user_name", help="your name")
    parser.add_argument("--tone", help="tone/personality description")
    parser.add_argument("--expertise", help="comma-separated list of topics")
    parser.add_argument("--instructions", help="free-text behavior rules")
    args = parser.parse_args()

    if args.show:
        print(json.dumps(load_current(), indent=2, ensure_ascii=False))
        return

    non_interactive = any([
        args.ai_name, args.user_name, args.tone, args.expertise, args.instructions
    ])
    if non_interactive:
        run_from_args(args)
    else:
        try:
            run_interactive()
        except (EOFError, KeyboardInterrupt):
            print("\nCancelled — persona.json left unchanged.")
            sys.exit(1)


if __name__ == "__main__":
    main()
