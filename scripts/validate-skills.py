#!/usr/bin/env python3
"""Validate pi skill frontmatter.

Mirrors pi's Agent Skills checks (see the pi skills doc):
- frontmatter must be a YAML mapping between --- delimiters
- `name` required, <=64 chars, lowercase a-z/0-9/hyphens, matches parent dir
- `description` required, <=1024 chars

Exits non-zero if any skill has an error.
"""

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("pyyaml is required: pip install pyyaml")

ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = ROOT / "skills"

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def extract_frontmatter(text: str) -> str | None:
    if not text.startswith("---"):
        return None
    lines = text.splitlines()
    if lines[0].strip() != "---":
        return None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "\n".join(lines[1:i])
    return None


def main() -> int:
    errors: list[str] = []
    skill_files = sorted(SKILLS_DIR.glob("*/SKILL.md"))

    if not skill_files:
        errors.append(f"no skills found under {SKILLS_DIR}")
    else:
        print(f"Found {len(skill_files)} skill(s)")

    for path in skill_files:
        dir_name = path.parent.name
        rel = str(path.relative_to(ROOT))
        text = path.read_text(encoding="utf-8")

        fm_text = extract_frontmatter(text)
        if fm_text is None:
            errors.append(f"{rel}: missing or malformed frontmatter (--- delimiters)")
            continue

        try:
            fm = yaml.safe_load(fm_text)
        except Exception as exc:  # noqa: BLE001 - report any parse failure
            errors.append(f"{rel}: YAML parse error: {exc}")
            continue

        if not isinstance(fm, dict):
            errors.append(f"{rel}: frontmatter is not a mapping")
            continue

        name = fm.get("name")
        if not name:
            errors.append(f"{rel}: missing 'name'")
        elif not isinstance(name, str):
            errors.append(f"{rel}: 'name' must be a string")
        elif name != dir_name:
            errors.append(f"{rel}: name '{name}' does not match directory '{dir_name}'")
        elif len(name) > 64:
            errors.append(f"{rel}: name is {len(name)} chars (max 64)")
        elif not NAME_RE.match(name):
            errors.append(f"{rel}: name '{name}' invalid (lowercase a-z/0-9, single hyphens)")

        desc = fm.get("description")
        if not desc:
            errors.append(f"{rel}: missing 'description'")
        elif not isinstance(desc, str):
            errors.append(f"{rel}: 'description' must be a string")
        elif len(desc) > 1024:
            errors.append(f"{rel}: 'description' is {len(desc)} chars (max 1024)")

        print(f"  ok  {rel}")

    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(f"FAIL  {e}")
        return 1

    print("All skills valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
