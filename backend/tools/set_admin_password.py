#!/usr/bin/env python3
"""Changes the admin dashboard password — the one place to do it, instead
of hand-editing backend/.env or hashing passwords in a Python REPL.

Writes directly to backend/.env (never .env.example, which is just a
template and isn't read by the app). Env vars are only read at process
startup, so the backend needs a restart after this runs.

Usage:
    python tools/set_admin_password.py              # prompts for the new password
    python tools/set_admin_password.py --email you@example.com   # also change the admin email
"""

import argparse
import getpass
import sys
from pathlib import Path

import bcrypt

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def update_env_var(env_path: Path, key: str, value: str) -> None:
    lines = env_path.read_text(encoding="utf-8").splitlines()
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", help="also update ADMIN_EMAIL")
    args = parser.parse_args()

    if not ENV_PATH.exists():
        print(f"{ENV_PATH} doesn't exist yet — copy .env.example to .env first.")
        sys.exit(1)

    password = getpass.getpass("New admin password: ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Passwords didn't match — nothing changed.")
        sys.exit(1)
    if len(password) < 8:
        print("Use at least 8 characters — nothing changed.")
        sys.exit(1)

    update_env_var(ENV_PATH, "ADMIN_PASSWORD_HASH", hash_password(password))
    if args.email:
        update_env_var(ENV_PATH, "ADMIN_EMAIL", args.email)

    print(f"Updated {ENV_PATH}.")
    print("Restart the backend for the change to take effect — env vars are only read at startup.")


if __name__ == "__main__":
    main()
