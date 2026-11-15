"""Glue for the toy line: station adapter, machine gate, status marker.

Every half-product is a file inside the item folder; status.json there is the
single record of where the item is. The engine (conductor or anything else)
only decides which of these commands runs next.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

MAX_ATTEMPTS = 3  # send-backs allowed per station before the line stops

# How to call each vendor's CLI agent non-interactively. The prompt goes in on stdin.
WORKERS = {
    "claude": ["claude", "-p", "Follow the station spec in the piped input. Print only the product text.",
               "--model", "haiku", "--tools", "", "--strict-mcp-config",
               "--disable-slash-commands", "--no-session-persistence"],
    "codex": ["codex", "exec", "--skip-git-repo-check", "-"],
    # Deterministic stand-in so the engine can be tested without spending model quota.
    "stub": [sys.executable, str(Path(__file__).resolve()), "stub"],
}

STUB_POINTS = ("- 老城区一栋六层居民楼三年前把闲置楼顶改成菜园\n- 第一年雨季排水口堵塞渗水，菜园险些被拆\n"
               "- 第二年重做防水并定下三条规矩，参与住户增至十一户\n- 第三年菜园成为公共客厅，顶楼夏季室温低两到三度\n"
               "- 冬季闲置、土壤板结和无人接手的箱子仍是问题")
STUB_SHORT = "楼顶菜园三年变成公共客厅。"
STUB_GOOD = ("老城区一栋居民楼三年前把闲置楼顶改成菜园，最初因排水堵塞渗水险些被拆；重做防水并定下规矩后，"
             "参与住户从两户增至十一户，如今成为楼里的公共客厅，顶楼夏季室温降低两到三度，但冬季闲置和无人接手的箱子仍是问题。")


def cmd_stub(_a) -> int:
    """Fake worker: first summary is too short on purpose; it only gets it right after a send-back."""
    prompt = sys.stdin.read()
    if "写摘要" not in prompt:
        print(STUB_POINTS)
    else:
        print(STUB_GOOD if "\n# 上次被退回的原因" in prompt else STUB_SHORT)
    return 0


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def write_atomic(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def update_status(item: Path, station: str, state: str, note: str = "") -> dict:
    path = item / "status.json"
    status = json.loads(read(path) or '{"attempts": {}, "history": []}')
    if state == "running":
        status["attempts"][station] = status["attempts"].get(station, 0) + 1
    status.update(station=station, state=state)
    status["history"].append({"at": time.strftime("%Y-%m-%d %H:%M:%S"), "station": station,
                              "state": state, "note": note})
    write_atomic(path, json.dumps(status, ensure_ascii=False, indent=2))
    return status


def cmd_station(a) -> int:
    item = Path(a.item)
    update_status(item, a.station, "running")
    feedback = read(item / a.feedback) if a.feedback else ""
    prompt = (f"# 工位规格\n{read(Path(a.spec))}\n\n# 输入半成品（{a.input}）\n{read(item / a.input)}\n"
              + (f"\n# 上次被退回的原因\n{feedback}\n" if feedback.strip() else ""))
    argv = list(WORKERS[a.worker])
    argv[0] = shutil.which(argv[0]) or argv[0]  # resolves claude.cmd on Windows
    started = time.time()
    try:
        proc = subprocess.run(argv, input=prompt, capture_output=True, text=True,
                              encoding="utf-8", timeout=a.timeout, cwd=item)
    except subprocess.TimeoutExpired:
        update_status(item, a.station, "failed", f"timeout after {a.timeout}s")
        return 1
    seconds = round(time.time() - started, 1)
    product = (proc.stdout or "").strip()
    if proc.returncode != 0 or not product:
        update_status(item, a.station, "failed",
                      f"exit {proc.returncode}, {seconds}s: {(proc.stderr or product)[:300]}")
        return 1
    write_atomic(item / a.output, product + "\n")
    update_status(item, a.station, "produced", f"{a.worker}, {seconds}s, {len(product)} chars")
    print(f"{a.station}: wrote {a.output} ({len(product)} chars, {seconds}s)")
    return 0


def cmd_gate(a) -> int:
    """Machine gate for the summary. Exit 0 pass, 1 send back, 2 over the limit (stop)."""
    item = Path(a.item)
    text = read(item / "20-summary.md").strip()
    count = len("".join(text.split()))
    problems = []
    if count > 120:  # say what to do, not just the number: models count characters badly
        problems.append(f"字数应在 60 到 120 之间，现在是 {count}，超出 {count - 120} 字。"
                        f"请删掉次要细节，压缩到 3 句话以内，大约是现在篇幅的 {round(9000 / count)}%")
    elif count < 60:
        problems.append(f"字数应在 60 到 120 之间，现在是 {count}，还差 {60 - count} 字。请补上最重要的一两个事实")
    if "\n" in text:
        problems.append("只能有一段，不能换行")
    if text.startswith(("以下", "好的", "摘要", "#", "-", "*")):
        problems.append("不能有开场白、标题或列表符号，直接写正文")
    for flag, once in (("_force_reject_once", True), ("_always_reject", False)):  # test switches
        if (item / flag).exists():
            problems.append("（测试开关）强制判不合格")
            if once:
                (item / flag).unlink()
    if not problems:
        (item / "20-summary.reject.md").unlink(missing_ok=True)
        update_status(item, "gate_summary", "passed", f"{count} chars")
        print("gate_summary: passed")
        return 0
    write_atomic(item / "20-summary.reject.md", "\n".join(f"- {p}" for p in problems) + "\n")
    attempts = json.loads(read(item / "status.json"))["attempts"].get("summarize", 0)
    if attempts >= MAX_ATTEMPTS:
        update_status(item, "gate_summary", "stopped", f"{attempts} attempts, still failing: {problems}")
        print(f"gate_summary: stopped after {attempts} attempts")
        return 2
    update_status(item, "gate_summary", "rejected", "; ".join(problems))
    print(f"gate_summary: rejected (attempt {attempts}) -> back to summarize")
    return 1


def cmd_mark(a) -> int:
    item = Path(a.item)
    if a.feedback_to:
        write_atomic(item / a.feedback_to, f"- 人工验收不合格：{a.note}\n")
    update_status(item, a.station, a.state, a.note)
    print(f"{a.station}: {a.state}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("station")
    for name in ("station", "spec", "item", "input", "output"):
        s.add_argument(f"--{name}", required=True)
    s.add_argument("--feedback", default="")
    s.add_argument("--worker", default="claude", choices=sorted(WORKERS))
    s.add_argument("--timeout", type=int, default=300)
    s.set_defaults(fn=cmd_station)
    g = sub.add_parser("gate")
    g.add_argument("--item", required=True)
    g.set_defaults(fn=cmd_gate)
    m = sub.add_parser("mark")
    for name in ("item", "station", "state"):
        m.add_argument(f"--{name}", required=True)
    m.add_argument("--note", default="")
    m.add_argument("--feedback-to", default="")
    m.set_defaults(fn=cmd_mark)
    sub.add_parser("stub").set_defaults(fn=cmd_stub)
    a = p.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
