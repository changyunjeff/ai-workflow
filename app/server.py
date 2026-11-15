"""Local server for the line canvas page.

Serves the built page and turns clicks into file changes and engine runs. It keeps
no state of its own: everything is read from and written to the line folder.
Usage: python app/server.py --line lines/article-summary [--port 8765]
"""
import argparse
import json
import mimetypes
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import engine as E

APP = Path(__file__).resolve().parent
WEB = APP / "web" / "dist"
LINE: Path = None   # the line the page is looking at right now
ROOT: Path = None   # the folder that holds all lines
LOCK = threading.Lock()  # one writer at a time for line.json


class Refuse(Exception):
    """A request we decline, with a plain-language reason for the user."""

    def __init__(self, message: str, **extra):
        super().__init__(message)
        self.extra = extra  # e.g. need_force=True: the page may ask "are you sure?" and resend with force


WORKER_NAMES = {"claude": "Claude", "codex": "Codex", "stub": "替身（测试用，固定输出）"}


def spawn(*args, log: Path) -> None:
    """Start the engine as its own process, so it outlives this request (and this server)."""
    log.parent.mkdir(parents=True, exist_ok=True)
    flags = 0x08000000 | 0x00000200 if os.name == "nt" else 0  # no window, own process group
    with open(log, "ab") as out:
        subprocess.Popen([sys.executable, str(APP / "engine.py"), *map(str, args)], stdout=out, stderr=subprocess.STDOUT,
                         stdin=subprocess.DEVNULL, env=E.clean_env(), cwd=APP, creationflags=flags)


def launch(item_id: str, start: str, only: bool = False) -> None:
    folder = LINE / "items" / item_id
    E.mark_launched(folder, start)
    spawn("run", "--line", LINE, "--item", item_id, "--from", start, *(["--only"] if only else []), log=folder / "run.log")


def load_line() -> dict:
    return E.load_json(LINE / "line.json")


def save_new_version(old: dict, new: dict, by: str, approved: bool, note: str) -> dict:
    """Keep the old version on disk, then write the new one. Every new version starts as a draft
    unless the user approved it by accepting it (an AI change they said yes to)."""
    E.save_json(LINE / "versions" / f"v{old['version']}.json", old)
    new["version"] = old["version"] + 1
    new.update(changed_by=by, changed_at=E.now()[:16], change_note=note)
    new.update(approved_version=new["version"] if approved else None, approved_at=E.now()[:16] if approved else None)
    E.save_json(LINE / "line.json", new)
    return new


def trial_dir(line: dict):
    latest = E.load_json(LINE / "trials" / "latest.json")
    folder = LINE / "trials" / latest["dir"] if latest else None
    result = E.load_json(folder / "result.json") if folder else None
    return (folder, result) if result and result.get("version") == line["version"] else (None, None)


def trial_of(line: dict):
    folder, result = trial_dir(line)
    if not result:
        return None
    if result.get("running"):
        age = time.time() - time.mktime(time.strptime(result["at"], "%Y-%m-%d %H:%M:%S"))
        if (not E.pid_alive(result["pid"])) if result.get("pid") else age > 30:  # its process is gone, or never started
            result.update(running=False, error=f"试跑中途断了，只跑完 {len(result.get('details', []))} 次。可以重新试跑。")
    out = {k: result.get(k) for k in ("version", "at", "runs", "ok", "running", "error")}
    out["items"], out["samples"] = result.get("details", []), result.get("samples", [])
    return out


def proposal_of():
    cur = E.load_json(LINE / "proposals" / "current.json")
    if not cur:
        return None
    folder = LINE / "proposals" / cur["id"]
    state = E.load_json(folder / "state.json") or \
        {"id": cur["id"], "state": "working", "scope": cur.get("scope"), "text": cur.get("text"), "summary": [], "trial": None, "error": None}
    if state["state"] == "working":
        age = time.time() - (folder / "request.json").stat().st_mtime
        if (not E.pid_alive(state["pid"])) if state.get("pid") else age > 30:  # its process is gone, or never started
            state.update(state="failed", error="AI 改到一半断了，这次改动作废。关掉之后可以重新提。")
        elif age > 900:
            state.update(state="failed", error="AI 改了 15 分钟还没有结果，这次改动作废了。关掉之后可以重新提。")
    state["requested_at"] = (E.load_json(folder / "request.json") or {}).get("at")
    if state["state"] == "ready":
        state["line"] = E.load_json(folder / "line.json")  # so the page can show what the line would look like
    return state


def pending_proposal() -> bool:
    cur = proposal_of()
    return bool(cur and cur["state"] in ("working", "ready"))


def history_of(line: dict) -> list:
    """Every version, newest first: who changed it, when, and what the change was."""
    rows = [{"version": line["version"], "by": line.get("changed_by"), "at": line.get("changed_at"),
             "note": line.get("change_note") or "最初的版本", "current": True}]
    for v in range(line["version"] - 1, 0, -1):
        old = E.load_json(LINE / "versions" / f"v{v}.json")
        if old:
            rows.append({"version": v, "by": old.get("changed_by"), "at": old.get("changed_at"),
                         "note": old.get("change_note") or "最初的版本", "current": False})
    return rows


def warnings_of(line: dict) -> list:
    nodes, flow = E.node_map(line), line["flow"]
    return [f"「{nodes[a]['title']}」后面还没有门" for a, b in zip(flow, flow[1:])
            if nodes[a]["kind"] == "station" and nodes[b]["kind"] != "gate"]


def trial_problem(trial) -> str:
    """Why a version should not be approved yet, or '' when its trial went through."""
    if not trial:
        return "这一版还没试跑过"
    if trial.get("running"):
        return "这一版正在试跑，还没出结果"
    if trial.get("error") or trial["ok"] < trial["runs"]:
        return f"这一版试跑 {trial['runs']} 次，只走通 {trial['ok']} 次"
    return ""


def item_dir(item_id: str) -> Path:
    folder = LINE / "items" / item_id
    if not item_id.isdigit() or not (folder / "status.json").exists():
        raise Refuse("找不到这件活")
    return folder


def line_dirs() -> list:
    return [d for d in sorted(ROOT.iterdir()) if d.is_dir() and not d.name.startswith(("_", ".")) and (d / "line.json").exists()]


def list_lines() -> list:
    """Every line under the root, with enough to choose one: name, approved or not, what is waiting."""
    out = []
    for folder in line_dirs():
        line, counts = E.load_json(folder / "line.json"), {}
        for item in (folder / "items").iterdir() if (folder / "items").exists() else []:
            st = E.load_json(item / "status.json") if (item / "status.json").exists() else None
            if st:
                counts[st["state"]] = counts.get(st["state"], 0) + 1
        pending = E.load_json(folder / "proposals" / "current.json")
        ready = bool(pending and (E.load_json(folder / "proposals" / pending["id"] / "state.json") or {}).get("state") == "ready")
        out.append({"id": folder.name, "name": line.get("name", folder.name), "version": line.get("version"),
                    "approved": line.get("approved_version") == line.get("version"),
                    "waiting": counts.get("waiting", 0), "stopped": counts.get("stopped", 0),
                    "running": counts.get("running", 0), "proposal_ready": ready, "current": folder == LINE})
    return out


def switch_line(body: dict) -> dict:
    global LINE
    target = next((d for d in line_dirs() if d.name == body.get("id")), None)
    if not target:
        raise Refuse("找不到这条线")
    LINE = target
    E.write_atomic(ROOT / ".current", target.name)
    return {}


def trial_item(kind: str, item_id: str) -> dict:
    """One item of the latest trial run (kind 'trial') or of the pending AI change's trial (kind 'proposal'). Read-only."""
    if kind == "trial":
        line = load_line()
        folder = trial_dir(line)[0]
    else:
        cur = proposal_of()
        line = (cur or {}).get("line")
        folder = LINE / "proposals" / cur["id"] / "trial" if line else None
    target = folder / "items" / item_id if folder and item_id.isdigit() else None
    if not target or not (target / "status.json").exists():
        raise Refuse("找不到这次试跑的活")
    out = E.item_detail(line, target)
    listed = next((d for d in (E.load_json(folder / "result.json") or {}).get("details", []) if d.get("id") == item_id), {})
    out.update(readonly=True, name=listed.get("name") or f"试跑第 {int(item_id)} 次")  # the same name the trial list uses
    return out


def safe_name(name: str) -> str:
    cleaned = "".join(c for c in str(name).strip() if c not in '\\/:*?"<>|\r\n\t').strip(". ")
    if not cleaned:
        raise Refuse("样例要有个名字")
    return cleaned[:40]


def add_sample(body: dict) -> dict:
    """A sample is one more piece of material every trial run is checked against."""
    text = str(body.get("text", ""))
    if not text.strip():
        raise Refuse("样例是空的")
    name = safe_name(body.get("name") or f"样例{len(E.sample_files(LINE)) + 1}")
    target = LINE / "sample" / f"{name}.md"
    if target.exists():
        raise Refuse(f"已经有一份叫「{name}」的样例了，换个名字")
    E.write_atomic(target, text.strip() + "\n")
    return {"name": name}


def remove_sample(body: dict) -> dict:
    target = LINE / "sample" / f"{safe_name(body.get('name', ''))}.md"
    if not target.exists():
        raise Refuse("找不到这份样例")
    if len(E.sample_files(LINE)) <= 1:
        raise Refuse("至少要留一份样例，不然没法试跑")
    target.unlink()
    return {}


def item_to_sample(item_id: str) -> dict:
    """Turn a real item's material into a sample, so the line is tested against the case that tripped it."""
    folder, line = item_dir(item_id), load_line()
    st, src = E.load_json(folder / "status.json"), E.node_map(line)[line["flow"][0]]
    return add_sample({"name": st.get("title") or st["name"], "text": E.read(folder / src["file"])})


def get_state() -> dict:
    line = load_line()
    line["trial"], line["proposal"] = trial_of(line), proposal_of()
    line["history"], line["warnings"] = history_of(line), warnings_of(line)
    line["worker_name"] = WORKER_NAMES.get(line.get("worker", "claude"), line.get("worker"))
    line["samples"] = [{"name": p.stem, "chars": E.count_chars(E.read(p))} for p in E.sample_files(LINE)]
    items, base = [], LINE / "items"
    for folder in sorted(base.iterdir()) if base.exists() else []:
        if (folder / "status.json").exists():
            st = E.load_json(folder / "status.json")
            if E.runner_dead(st):
                st = E.item_detail(line, folder)  # notices the dead runner and records the stop
            items.append({"id": st["id"], "name": st["name"], "title": st.get("title", ""), "state": st["state"],
                          "state_name": E.STATE_NAMES.get(st["state"], st["state"]), "at": st["at"], "created": st["created"]})
    return {"line": line, "items": items, "lines": list_lines(), "now": E.now()}


# ---------- actions ----------

def feed(body: dict) -> dict:
    line, text = load_line(), str(body.get("text", ""))
    if line.get("approved_version") != line["version"]:
        raise Refuse("这条线还是草稿。先批准这条线，批准之后才能正式投料。")
    if not text.strip():
        raise Refuse("原料是空的")
    item_id = E.new_item(LINE / "items", line, text, str(body.get("title", "")))
    launch(item_id, line["flow"][0])
    return {"id": item_id}


def must_be_approved(line: dict, what: str) -> None:
    """A draft never does real work: anything that makes a worker run on a real item needs an approved line."""
    if line.get("approved_version") != line["version"]:
        raise Refuse(f"这条线现在是草稿（第 {line['version']} 版还没批准）。草稿不干正式的活：先批准这条线，再{what}。")


def decide(item_id: str, body: dict) -> dict:
    folder, line, approve = item_dir(item_id), load_line(), bool(body.get("approve"))
    gate = E.node_map(line).get(body.get("node"))
    if not gate:
        raise Refuse("找不到这道门")
    ships = approve and E.node_map(line)[E.next_id(line, gate["id"])]["kind"] == "product"
    if not ships:  # shipping a finished product needs no worker; everything else does
        must_be_approved(line, "退回重写" if not approve else "让这件活继续往后走")
    try:
        nxt = E.decide(line, folder, gate["id"], approve, str(body.get("reason", "")))
    except (ValueError, KeyError) as e:
        raise Refuse(str(e))
    if nxt:
        launch(item_id, nxt)
    return {"next": nxt}


def rerun(item_id: str, body: dict) -> dict:
    folder = item_dir(item_id)
    must_be_approved(load_line(), "重做这件活")
    try:
        E.prepare_rerun(load_line(), folder, body.get("from"))
    except (ValueError, KeyError) as e:
        raise Refuse(str(e))
    launch(item_id, body["from"], bool(body.get("only")))
    return {}


def abandon(item_id: str) -> dict:
    item = E.Item(item_dir(item_id))
    if item.st["state"] == "running" and not E.runner_dead(item.st):
        raise Refuse("这件活正在做，等它停下再放弃")
    if item.st["state"] == "done":
        raise Refuse("这件活已经出货了")
    item.st["state"] = "abandoned"
    item.note("这件活", "已放弃", "文件都保留着")
    item.save()
    return {}


def edit_node(body: dict) -> dict:
    if pending_proposal():
        raise Refuse("AI 的改动还没处理完。先采用或不要它，再自己改，免得两边的改动互相冲掉。")
    with LOCK:
        old = load_line()
        new = json.loads(json.dumps(old))
        node, patch = E.node_map(new).get(body.get("id")), body.get("patch") or {}
        if not node:
            raise Refuse("找不到这个节点")
        gate_keys = {"machine": ("checks", "max_tries"), "ai": ("criteria", "max_tries"), "human": ("points",)}
        allowed = {"station": ("spec",), "gate": gate_keys.get(node.get("judge"), ())}.get(node["kind"], ())
        if not patch or any(k not in allowed for k in patch):
            raise Refuse("这个节点不能改这一项")
        if "checks" in patch:
            checks = {k: v for k, v in dict(node["checks"], **patch["checks"]).items() if v not in (None, "", [])}  # empty = no limit
            for key in ("min_chars", "max_chars"):
                if key in checks and (not isinstance(checks[key], int) or isinstance(checks[key], bool) or checks[key] < 0):
                    raise Refuse("字数要填 0 以上的整数")
            if "must_include" in checks and not (isinstance(checks["must_include"], list)
                                                 and all(isinstance(s, str) and s.strip() for s in checks["must_include"])):
                raise Refuse("“必须包含”要一行写一条，不能有空行")
            if checks.get("min_chars") and checks.get("max_chars") and checks["min_chars"] > checks["max_chars"]:
                raise Refuse("最少字数不能比最多字数大")
            node["checks"] = checks
        if "max_tries" in patch:
            if not isinstance(patch["max_tries"], int) or not 1 <= patch["max_tries"] <= 10:
                raise Refuse("最多写几次要填 1 到 10 之间的整数")
            node["max_tries"] = patch["max_tries"]
        for key in ("spec", "points", "criteria"):
            if key in patch:
                if not str(patch[key]).strip():
                    raise Refuse("不能改成空的")
                node[key] = str(patch[key]).strip()
        problems = E.validate_line(new)
        if problems:
            raise Refuse("这样改线就跑不了了：" + "；".join(problems))
        what = {"spec": "规格", "points": "验收要点", "criteria": "合格标准"}.get(next(iter(patch)), "标准")
        new = save_new_version(old, new, "你", approved=False, note=f"你改了「{node['title']}」的{what}")
    if body.get("trial"):
        start_trial({})
    return {"version": new["version"]}


def set_layout(body: dict) -> dict:
    with LOCK:
        line = load_line()
        line["layout"] = {str(k): [round(float(v[0])), round(float(v[1]))] for k, v in (body.get("layout") or {}).items()}
        E.save_json(LINE / "line.json", line)
    return {}


def approve(yes: bool, force: bool = False) -> dict:
    with LOCK:
        line = load_line()
        if yes and not force:
            one = "只在一份样例上试跑过，换一份原料不一定走得通" if len(E.sample_files(LINE)) < 2 else ""
            concerns = [c for c in [trial_problem(trial_of(line)), one] + warnings_of(line) if c]
            if concerns:
                raise Refuse("批准之前请留意：" + "；".join(concerns) + "。", need_force=True, concerns=concerns)
        line.update(approved_version=line["version"] if yes else None, approved_at=E.now()[:16] if yes else None)
        E.save_json(LINE / "line.json", line)
    return {}


def revert(body: dict) -> dict:
    """Bring back the content of an earlier version as a new version (history is never rewritten)."""
    if pending_proposal():
        raise Refuse("AI 的改动还没处理完。先采用或不要它，再换版本。")
    with LOCK:
        cur = load_line()
        to = body.get("to", cur["version"] - 1)
        old = E.load_json(LINE / "versions" / f"v{to}.json") if isinstance(to, int) else None
        if not old:
            raise Refuse("找不到要换回的那一版")
        old["layout"] = cur.get("layout", {})
        new = save_new_version(cur, old, "你", approved=False, note=f"换回了第 {to} 版的内容")
    return {"version": new["version"]}


def start_trial(body: dict) -> dict:
    line = load_line()
    running = trial_of(line)
    if running and running.get("running"):
        raise Refuse("正在试跑，等这一轮跑完")
    count = len(E.sample_files(LINE))
    runs = body.get("runs", 3 if count < 2 else 2)  # times per sample
    if not isinstance(runs, int) or not 1 <= runs <= 10:
        raise Refuse("每份样例的试跑次数要在 1 到 10 之间")
    name = time.strftime("%Y%m%d-%H%M%S")  # say "running" right away, so the page never shows the previous result meanwhile
    E.save_json(LINE / "trials" / name / "result.json",
                {"version": line["version"], "at": E.now(), "runs": runs * max(count, 1), "ok": 0, "running": True,
                 "details": [], "samples": []})
    E.save_json(LINE / "trials" / "latest.json", {"dir": name})
    spawn("trial", "--line", LINE, "--runs", runs, "--out", name, log=LINE / "trials" / "trial.log")
    return {}


def ask_ai(body: dict) -> dict:
    line, text, scope = load_line(), str(body.get("text", "")).strip(), body.get("scope", "line")
    if not text:
        raise Refuse("先写一句意见")
    if scope != "line" and scope not in E.node_map(line):
        raise Refuse("找不到这个节点")
    cur = proposal_of()
    if cur and cur["state"] in ("working", "ready"):
        raise Refuse("上一个 AI 改动还没处理完。先采用或不要它，再提新的意见。")
    pid = time.strftime("%Y%m%d-%H%M%S")
    E.save_json(LINE / "proposals" / pid / "request.json", {"scope": scope, "text": text, "at": E.now()})
    E.save_json(LINE / "proposals" / "current.json", {"id": pid, "scope": scope, "text": text})
    spawn("propose", "--line", LINE, "--id", pid, log=LINE / "proposals" / pid / "propose.log")
    return {"id": pid}


def accept_ai(yes: bool, force: bool = False) -> dict:
    cur = proposal_of()
    if not cur:
        raise Refuse("现在没有等你处理的 AI 改动")
    if yes:
        if cur["state"] != "ready":
            raise Refuse("AI 还没改完，或者这次没改成")
        with LOCK:
            old, folder = load_line(), LINE / "proposals" / cur["id"]
            if cur.get("base_version") not in (None, old["version"]):
                raise Refuse(f"AI 是照第 {cur['base_version']} 版改的，可这条线后来又变成了第 {old['version']} 版。"
                             f"直接采用会冲掉后来的改动。请点“不要”，再把意见重新提一次。")
            trial = cur.get("trial") or {}
            if not force and (trial.get("error") or trial.get("ok", 0) < trial.get("runs", 1)):
                concern = f"AI 改完后试跑 {trial.get('runs', 0)} 次，只走通 {trial.get('ok', 0)} 次"
                raise Refuse(f"采用之前请留意：{concern}。", need_force=True, concerns=[concern])
            new = E.load_json(folder / "line.json")
            new["layout"] = dict(new.get("layout", {}), **{k: v for k, v in old.get("layout", {}).items() if k in E.node_map(new) or k == "stop"})
            note = f"你的意见：{cur.get('text', '')}。AI 改了：" + "；".join(cur.get("summary", []))
            # accepting approves the AI's change only; unapproved edits already sitting in the draft stay unapproved
            was_approved = old.get("approved_version") == old["version"]
            new = save_new_version(old, new, "AI（你点头采用）", approved=was_approved, note=note)
            result = E.load_json(folder / "trial" / "result.json")
            if result:  # the trial was run on this very definition; carry it over to the new version number
                result["version"] = new["version"]
                E.save_json(LINE / "trials" / f"from-{cur['id']}" / "result.json", result)
                E.save_json(LINE / "trials" / "latest.json", {"dir": f"from-{cur['id']}"})
    (LINE / "proposals" / "current.json").unlink(missing_ok=True)
    line = load_line()
    return {"approved": line.get("approved_version") == line["version"], "version": line["version"]}


def open_path(body: dict) -> dict:
    folder = item_dir(str(body.get("item", "")))
    target = (folder / str(body["file"])).resolve() if body.get("file") else folder.resolve()
    if folder.resolve() not in (target, *target.parents) or not target.exists():
        raise Refuse("找不到这个文件")
    os.startfile(target)  # Windows: opens with the default program
    return {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep the console quiet
        pass

    def send_json(self, data, code=200):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def answer(self, fn):
        try:
            self.send_json(dict(fn() or {}, ok=True))
        except Refuse as e:
            self.send_json(dict(e.extra, ok=False, error=str(e)), 400)
        except Exception as e:
            self.send_json({"ok": False, "error": f"程序出错了：{e}"}, 500)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/state":
            return self.answer(get_state)
        if path.startswith("/api/item/"):
            return self.answer(lambda: E.item_detail(load_line(), item_dir(path.split("/")[3])))
        if path.startswith(("/api/trial/item/", "/api/proposal/item/")):
            return self.answer(lambda: trial_item(path.split("/")[2], path.split("/")[4]))
        if path.startswith("/api/"):
            return self.send_json({"ok": False, "error": "没有这个接口"}, 404)
        rel = path.lstrip("/") or "index.html"
        target = (WEB / rel).resolve()
        if WEB.resolve() not in target.parents or not target.is_file():
            target = WEB / "index.html"
        if not target.is_file():
            return self.send_json({"ok": False, "error": "页面还没构建：在 app/web 里运行 npm run build"}, 404)
        raw = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except json.JSONDecodeError:
            return self.send_json({"ok": False, "error": "发来的内容看不懂"}, 400)
        parts = path.strip("/").split("/")
        routes = {
            "api/item": lambda: feed(body),
            "api/lines/switch": lambda: switch_line(body),
            "api/line/sample": lambda: add_sample(body),
            "api/line/sample/remove": lambda: remove_sample(body),
            "api/line/node": lambda: edit_node(body),
            "api/line/layout": lambda: set_layout(body),
            "api/line/approve": lambda: approve(True, bool(body.get("force"))),
            "api/line/unapprove": lambda: approve(False),
            "api/line/revert": lambda: revert(body),
            "api/line/trial": lambda: start_trial(body),
            "api/ai": lambda: ask_ai(body),
            "api/ai/accept": lambda: accept_ai(True, bool(body.get("force"))),
            "api/ai/reject": lambda: accept_ai(False),
            "api/open": lambda: open_path(body),
        }
        if len(parts) == 4 and parts[:2] == ["api", "item"]:
            action = {"decide": lambda: decide(parts[2], body), "run": lambda: rerun(parts[2], body),
                      "abandon": lambda: abandon(parts[2]), "sample": lambda: item_to_sample(parts[2])}.get(parts[3])
        else:
            action = routes.get("/".join(parts))
        if not action:
            return self.send_json({"ok": False, "error": "没有这个接口"}, 404)
        self.answer(action)


def main() -> None:
    global LINE, ROOT
    p = argparse.ArgumentParser()
    p.add_argument("--lines", help="folder that holds all lines; the page can switch between them")
    p.add_argument("--line", help="the line to open first (a folder); defaults to the one opened last time")
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    if not args.lines and not args.line:
        sys.exit("要给 --lines（放所有线的文件夹）或 --line（某一条线的文件夹）")
    ROOT = Path(args.lines).resolve() if args.lines else Path(args.line).resolve().parent
    if args.line:
        LINE = Path(args.line).resolve()
    else:
        last = E.read(ROOT / ".current").strip()
        LINE = next((d for d in line_dirs() if d.name == last), None) or next(iter(line_dirs()), None)
        if not LINE:
            sys.exit(f"{ROOT} 里还没有任何一条线")
    for folder in line_dirs():
        problems = E.validate_line(E.load_json(folder / "line.json"))
        if problems:
            print(f"注意：「{folder.name}」这条线的定义有问题：" + "；".join(problems), flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"line canvas: http://127.0.0.1:{args.port}/  (line: {LINE})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
