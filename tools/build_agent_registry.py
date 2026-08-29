#!/usr/bin/env python3
"""build_agent_registry.py — the published agents in this estate, with their hashes.

The organism forge adapts a REAL agent rather than inventing one, and it refuses bytes it cannot
verify. That needs a registry built from the files themselves.
"""
import ast, hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "state" / "agent_templates.json"


def manifest_of(src):
    try:
        tree = ast.parse(src)
    except Exception:
        return None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Attribute) and t.attr == "metadata":
                    try:
                        return ast.literal_eval(node.value)
                    except Exception:
                        return None
    return None


def main():
    out = []
    for f in sorted((ROOT / "ai" / "vb").glob("*_agent.py")):
        src = f.read_text(encoding="utf-8")
        m = manifest_of(src) or {}
        out.append({
            "file": "ai/vb/" + f.name,
            "name": m.get("name") or f.stem,
            "description": (m.get("description") or "").strip()[:240],
            "sha256": hashlib.sha256(src.encode("utf-8")).hexdigest(),
            "bytes": len(src),
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"schema": "nexus-agent-templates/1", "count": len(out),
                               "templates": out}, indent=1, sort_keys=True) + "\n")
    print(f"✓ {OUT.relative_to(ROOT)} — {len(out)} published agents, each with its sha256")
    for t in out:
        print(f"    {t['name']:<16} {t['sha256'][:12]}…  {t['bytes']:>6}B")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
