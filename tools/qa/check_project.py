#!/usr/bin/env python3
"""检查文档链接与锚点、受保护提示词和敏感文件边界。"""

from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
PROMPT_IDENTITY_CHECKER = ROOT / "tools/qa/protected_prompts.js"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def markdown_anchors(markdown: Path) -> set[str]:
    anchors: set[str] = set()
    counts: dict[str, int] = {}
    for line in read(markdown).splitlines():
        match = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", line)
        if not match:
            continue
        heading = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", match.group(1))
        heading = re.sub(r"<[^>]+>|[`*_~]", "", heading).lower()
        base = re.sub(r"[^\w\s-]", "", heading, flags=re.UNICODE)
        base = re.sub(r"[\s-]+", "-", base).strip("-")
        if not base:
            continue
        duplicate = counts.get(base, 0)
        counts[base] = duplicate + 1
        anchors.add(base if duplicate == 0 else f"{base}-{duplicate}")
    return anchors


def check_markdown_links(errors: list[str]) -> None:
    pattern = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
    anchor_cache: dict[Path, set[str]] = {}
    for markdown in ROOT.rglob("*.md"):
        if any(part in {".git", ".gradle", "build", ".tmp", "node_modules", ".claude"} for part in markdown.relative_to(ROOT).parts):
            continue
        for match in pattern.finditer(read(markdown)):
            target = match.group(1).strip()
            if not target or re.match(r"^(?:https?://|mailto:|file:)", target):
                continue
            relative, separator, fragment = target.partition("#")
            destination = (markdown.parent / relative).resolve() if relative else markdown.resolve()
            try:
                destination.relative_to(ROOT)
            except ValueError:
                continue  # 仓库外的目标（绝对路径或越出仓库根的相对路径）不检查存在性
            if relative and not destination.exists():
                errors.append(
                    f"Markdown 相对链接不存在：{markdown.relative_to(ROOT).as_posix()} -> {target}"
                )
                continue
            if separator and fragment and destination.suffix.lower() == ".md":
                anchors = anchor_cache.setdefault(destination, markdown_anchors(destination))
                if unquote(fragment).lower() not in anchors:
                    errors.append(
                        f"Markdown 相对锚点不存在：{markdown.relative_to(ROOT).as_posix()} -> {target}"
                    )


def check_prompt_identity_manifest(errors: list[str]) -> None:
    # One evaluator owns Prompt identity; see tools/qa/protected_prompts.js.
    try:
        result = subprocess.run(
            ["node", str(PROMPT_IDENTITY_CHECKER)],
            cwd=ROOT,
            capture_output=True,
            encoding="utf-8",
        )
    except OSError as error:
        errors.append(f"受保护 Prompt 门禁无法运行：{error}")
        return
    if result.returncode != 0:
        reported = [line for line in result.stdout.splitlines() if line.strip()]
        errors.extend(reported or [f"受保护 Prompt 门禁运行失败：{result.stderr.strip()}"])


def main() -> int:
    errors: list[str] = []
    check_markdown_links(errors)
    check_prompt_identity_manifest(errors)

    if (ROOT / "local.properties").exists():
        try:
            tracked = subprocess.check_output(["git", "ls-files", "local.properties"], cwd=ROOT, text=True).strip()
        except (OSError, subprocess.CalledProcessError):
            tracked = ""
        if tracked:
            errors.append("local.properties 已进入 Git 跟踪范围")

    if errors:
        print("项目检查失败：", file=sys.stderr)
        print("\n".join(f"- {item}" for item in errors), file=sys.stderr)
        return 1
    print("project checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
