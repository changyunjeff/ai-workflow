"""Line engine: moves one item through a line, one segment at a time.

Everything it knows lives in files (see docs/05-产线文件与接口.md). Every step writes
status.json first and works second, so the page always shows the truth and a
stopped segment can be picked up again from the files alone.
"""
import argparse
import ctypes
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

import shader_check

# How to call each vendor's CLI agent without a chat window. The task goes in on stdin.
WORKERS = {
    "claude": ["claude", "-p", "Follow the task in the piped input. Print only the product text.",
               "--model", "{model}", "--tools", "", "--strict-mcp-config",
               "--disable-slash-commands", "--no-session-persistence"],
    "codex": ["codex", "exec", "--skip-git-repo-check", "-"],  # not yet verified on this PC
    "stub": [sys.executable, str(Path(__file__).resolve()), "stub"],  # fixed output, for tests
}
STATE_NAMES = {"running": "正在做", "waiting": "等你验收", "stopped": "停线", "done": "已出货",
               "abandoned": "已放弃", "idle": "停着"}


def now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig") if path.exists() else ""  # tolerate a BOM from Notepad


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    for attempt in range(20):  # a reader may briefly hold the file open on Windows
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.05)
    os.replace(tmp, path)


def load_json(path: Path, default=None):
    for attempt in range(20):
        try:
            return json.loads(path.read_text(encoding="utf-8-sig"))
        except FileNotFoundError:
            return default
        except (json.JSONDecodeError, PermissionError):
            time.sleep(0.05)
    return json.loads(path.read_text(encoding="utf-8-sig"))


def save_json(path: Path, data) -> None:
    write_atomic(path, json.dumps(data, ensure_ascii=False, indent=2))


def count_chars(text: str) -> int:
    return len("".join(text.split()))


def pid_alive(pid) -> bool:
    if not pid:
        return False
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))
    if not handle:
        return False
    code = ctypes.c_ulong()
    ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
    ctypes.windll.kernel32.CloseHandle(handle)
    return code.value == 259  # STILL_ACTIVE


def mark_launched(item_dir: Path, start: str) -> None:
    """Called just before a runner process is started, so the page never shows a stale place in between."""
    st = load_json(Path(item_dir) / "status.json")
    st.update(state="running", at=start, pid=None, launched=time.time())
    save_json(Path(item_dir) / "status.json", st)


def runner_dead(st: dict) -> bool:
    if st["state"] != "running" or pid_alive(st.get("pid")):
        return False
    return not (st.get("pid") is None and time.time() - st.get("launched", 0) < 20)  # still starting up


def clean_env() -> dict:
    """Workers must use the user's own CLI login, not the plumbing of a host app session."""
    env = dict(os.environ, PYTHONUTF8="1")
    if "CLAUDECODE" in env or "CLAUDE_CODE_ENTRYPOINT" in env:
        for key in list(env):
            if key.startswith(("CLAUDE_CODE_", "CLAUDECODE", "CLAUDE_AGENT_SDK_", "CLAUDE_PID", "CLAUDE_PREVIEW")) \
                    or key == "ANTHROPIC_BASE_URL":
                del env[key]
    return env


# ---------- line definition ----------

def node_map(line: dict) -> dict:
    return {n["id"]: n for n in line["nodes"]}


def next_id(line: dict, node_id: str):
    flow = line["flow"]
    i = flow.index(node_id)
    return flow[i + 1] if i + 1 < len(flow) else None


def validate_line(line: dict) -> list:
    """Return plain-language problems; an empty list means the definition can run."""
    bad = []
    try:
        nodes, flow = node_map(line), line["flow"]
        if len(nodes) != len(line["nodes"]):
            bad.append("有两个节点用了同一个编号")
        if not flow or any(i not in nodes for i in flow):
            bad.append("主线里有不存在的节点")
            return bad
        if nodes[flow[0]]["kind"] != "source" or nodes[flow[-1]]["kind"] != "product":
            bad.append("主线必须从原料开始、到成品结束")
        for pos, node_id in enumerate(flow):
            n = nodes[node_id]
            if n["kind"] == "station":
                for key in ("input", "output", "spec"):
                    if not str(n.get(key, "")).strip():
                        bad.append(f"站「{n.get('title', node_id)}」缺少 {key}")
                refs = n.get("refs") or []
                if not isinstance(refs, list) or not all(isinstance(r, str) and r.strip() for r in refs):
                    bad.append(f"站「{n.get('title', node_id)}」的参考材料要写成文件名的列表")
            elif n["kind"] == "gate":
                if n.get("judge") not in ("machine", "ai", "human"):
                    bad.append(f"门「{n.get('title', node_id)}」没写清谁来判")
                target = n.get("on_fail")
                if target not in flow[:pos] or nodes[target]["kind"] != "station":
                    bad.append(f"门「{n.get('title', node_id)}」不合格时要退回它前面的某一站")
                if not n.get("file"):
                    bad.append(f"门「{n.get('title', node_id)}」没写检查哪个文件")
                if n.get("judge") == "machine" and (not isinstance(n.get("max_tries"), int) or n["max_tries"] < 1
                                                   or not isinstance(n.get("checks"), dict)):
                    bad.append(f"机器门「{n.get('title', node_id)}」缺少检查项或次数上限")
                if n.get("judge") == "ai" and (not isinstance(n.get("max_tries"), int) or n["max_tries"] < 1
                                              or not str(n.get("criteria", "")).strip()):
                    bad.append(f"AI 判的门「{n.get('title', node_id)}」缺少合格标准或次数上限")
            elif n["kind"] not in ("source", "product"):
                bad.append(f"节点「{node_id}」的类型不认识")
            elif pos not in (0, len(flow) - 1):
                bad.append("原料和成品只能在主线的两头")
    except (KeyError, TypeError, AttributeError) as e:
        bad.append(f"定义的格式不对：{e}")
    return bad


def gate_requirements(checks: dict) -> list:
    out = []
    lo, hi = checks.get("min_chars"), checks.get("max_chars")
    if lo and hi:
        out.append(f"字数在 {lo} 到 {hi} 个字之间，目标取中间偏短；超过 {hi} 字会被退回，宁短勿长")
    elif hi:
        out.append(f"不超过 {hi} 个字，宁短勿长")
    elif lo:
        out.append(f"不少于 {lo} 个字")
    if checks.get("single_paragraph"):
        out.append("只有一段，不换行")
    if checks.get("no_preamble"):
        out.append("不要开场白、标题、列表符号，直接写正文")
    if checks.get("must_include"):
        out.append("必须原样包含这些文字：" + "、".join(f"「{s}」" for s in checks["must_include"]))
    if checks.get("keep_backticks_from"):
        out.append(f"{checks['keep_backticks_from']} 里用反引号（`）括起来的内容，必须连同反引号原样保留，不翻译、不改动")
    if checks.get("urp_shader"):
        out += shader_check.RULES
    return out


AI_JUDGE = """你是质检员。按下面的合格标准检查“待检查的产出”。只依据标准判断，不要改写产出，不要加标准以外的要求。

# 合格标准
{criteria}

# 参考材料（{ref_name}）
{ref}

# 待检查的产出（{name}）
{text}

只输出一个 JSON 对象，不要任何别的文字：{{"pass": true 或 false, "problems": ["不合格的地方：哪里不对，该怎么改"]}}。合格时 problems 是空数组。"""


def judge_ai(line: dict, node: dict, item_dir: Path, text: str) -> list:
    """A gate judged by another model call. Returns (short, how-to-fix) pairs like judge_machine."""
    refs = node.get("reference") or node_map(line)[node["on_fail"]]["input"]
    refs = [refs] if isinstance(refs, str) else list(refs)  # one file name, or several
    ref = read(item_dir / refs[0]).strip() + "".join(f"\n\n# 参考材料（{r}）\n{read(item_dir / r).strip()}" for r in refs[1:])
    prompt = AI_JUDGE.format(criteria=node["criteria"].strip(), ref_name=refs[0], ref=ref, name=node["file"], text=text.strip())
    for attempt in range(2):  # one retry if the answer is not usable
        answer, err, _ = call_worker(line, prompt, item_dir, int(node.get("timeout", 300)), model=line.get("judge_model", "sonnet"))
        if answer is None:
            continue
        try:
            data = json.loads(answer[answer.index("{"):answer.rindex("}") + 1])
            problems = [str(p) for p in data.get("problems", [])]
            if data.get("pass") is True:
                return []
            return [(p[:40], p) for p in problems] or [("质检判了不合格", "质检判了不合格，但没有说明原因")]
        except (ValueError, AttributeError):
            err = "质检员的回答看不懂"
    raise RuntimeError(f"「{node['title']}」这道门没判成：{err}")


def judge_machine(checks: dict, text: str, item_dir: Path = None) -> list:
    """Return (short, how-to-fix) pairs. The fix text goes back to the worker, so it must be actionable."""
    text, n, out = text.strip(), count_chars(text), []
    source = checks.get("keep_backticks_from")
    if source and item_dir:  # checked against this item's own material, never against a list frozen at design time
        spans = dict.fromkeys(re.findall(r"`[^`\n]+`", read(Path(item_dir) / source)))
        missing = [s for s in spans if s not in text]
        if missing:
            out.append((f"有 {len(missing)} 处反引号内容没原样保留",
                        "这些内容必须连同反引号原样出现在产出里，不能翻译或改写：" + "、".join(missing[:12])))
    lo, hi = checks.get("min_chars"), checks.get("max_chars")
    if hi and n > hi:
        out.append((f"超出 {n - hi} 字（上限 {hi}）", f"字数上限是 {hi}，现在是 {n}，超出 {n - hi} 字。"
                    f"请删掉次要细节，压缩到大约现在篇幅的 {round(hi * 75 / n)}%，宁短勿长"))
    if lo and n < lo:
        out.append((f"少 {lo - n} 字", f"字数下限是 {lo}，现在是 {n}，还差 {lo - n} 字。请补上最重要的一两个事实"))
    if checks.get("single_paragraph") and "\n" in text:
        out.append(("不止一段", "只能有一段，不能换行"))
    if checks.get("no_preamble") and text.startswith(("以下", "好的", "摘要", "#", "-", "*")):
        out.append(("有开场白或标题", "不能有开场白、标题或列表符号，直接写正文"))
    for must in checks.get("must_include") or []:
        if must not in text:
            out.append((f"缺少「{must}」", f"产出里必须原样出现「{must}」，现在没有"))
    if checks.get("urp_shader"):  # static checks only; compiling needs Unity itself
        out += shader_check.check(text)
    return out


# ---------- one item ----------

class Item:
    def __init__(self, folder: Path):
        self.dir = Path(folder)
        self.st = load_json(self.dir / "status.json")

    def save(self):
        save_json(self.dir / "status.json", self.st)

    def note(self, title, what, detail=""):
        self.st["history"].append([time.strftime("%H:%M:%S"), title, what, detail])

    def set_node(self, node_id, state, **extra):
        self.st["nodes"][node_id] = dict(state=state, **extra)

    def walk(self, a, b):
        key = f"{a}>{b}"
        if key not in self.st["walked"]:
            self.st["walked"].append(key)

    def stop(self, why, resume_from):
        self.st.update(state="stopped", at="stop", why=why, resume_from=resume_from)
        self.set_node("stop", "stopped")
        self.note("停线", "停下等你处理", why)
        self.save()


def new_item(base: Path, line: dict, text: str, title: str = "") -> str:
    base.mkdir(parents=True, exist_ok=True)
    used = [int(p.name) for p in base.iterdir() if p.is_dir() and p.name.isdigit()]
    num = max(used, default=0) + 1
    item_id, src = f"{num:04d}", node_map(line)[line["flow"][0]]
    folder = base / item_id
    folder.mkdir()
    write_atomic(folder / src["file"], text.strip() + "\n")
    save_json(folder / "status.json", {
        "id": item_id, "name": f"第 {num} 件", "title": title, "created": now(), "line_version": line["version"],
        "state": "idle", "at": src["id"], "why": None, "pid": None,
        "nodes": {src["id"]: {"state": "done"}}, "walked": [], "back": {}, "round": {}, "tries": {}, "judged": {},
        "history": [[time.strftime("%H:%M:%S"), src["title"], "投料", f"{count_chars(text)} 字"]]})
    return item_id


def call_worker(line: dict, prompt: str, cwd: Path, timeout: int, model: str = None):
    argv = [a.format(model=model or line.get("model", "haiku")) for a in WORKERS[line.get("worker", "claude")]]
    argv[0] = shutil.which(argv[0]) or argv[0]  # finds claude.cmd on Windows
    started = time.time()
    try:
        proc = subprocess.run(argv, input=prompt, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=timeout, cwd=cwd, env=clean_env(),
                              creationflags=0x08000000 if os.name == "nt" else 0)  # no console window flashing up
    except subprocess.TimeoutExpired:
        return None, f"超过 {timeout} 秒没做完，判为卡住", round(time.time() - started, 1)
    except OSError as e:
        return None, f"调不起工人：{e}", 0
    out, secs = (proc.stdout or "").strip(), round(time.time() - started, 1)
    if proc.returncode != 0 or not out:
        return None, ((proc.stderr or out).strip()[:300] or f"工人退出码 {proc.returncode}，没有产出"), secs
    return out, None, secs


def station_prompt(line: dict, node: dict, item_dir: Path) -> str:
    flow, nodes, must = line["flow"], node_map(line), []
    for later in flow[flow.index(node["id"]) + 1:]:  # the gates between this station and the next one
        g = nodes[later]
        if g["kind"] != "gate":
            break
        if g.get("file") != node["output"]:
            continue
        if g.get("judge") == "machine":
            must += gate_requirements(g.get("checks", {}))
        elif g.get("judge") == "ai":  # tell the worker up front what the inspector will look for
            must += [s.strip("-• ").strip() for s in g["criteria"].splitlines() if s.strip()]
    feedback = read(item_dir / "feedback" / f"{node['id']}.md").strip()
    refs = "".join(f"# 参考材料（{name}）\n{read(item_dir / name).strip()}\n\n" for name in node.get("refs") or [])
    return (f"# 这一步要做什么\n{node['spec'].strip()}\n\n"
            + (("# 产出必须满足（会被自动检查，不满足会退回重做）\n" + "\n".join(f"- {m}" for m in must) + "\n\n") if must else "")
            + f"# 输入（{node['input']}）\n{read(item_dir / node['input']).strip()}\n\n" + refs
            + (f"# 上次被退回的原因\n{feedback}\n\n" if feedback else "")
            + "只输出产出的正文，不要任何解释、开场白或结尾。")


def do_station(line: dict, node: dict, item: Item) -> bool:
    st, nid = item.st, node["id"]
    st["round"][nid] = st["round"].get(nid, 0) + 1
    st.update(state="running", at=nid)
    item.set_node(nid, "run", since=time.time())
    item.save()
    out, err, secs = call_worker(line, station_prompt(line, node, item.dir), item.dir, int(node.get("timeout", 300)),
                                 model=node.get("model"))  # a station may ask for a stronger model than the line's default
    if out is None:
        item.set_node(nid, "fail")
        item.note(node["title"], "出错", err)
        item.stop(f"「{node['title']}」这一步没做成：{err}", nid)
        return False
    tries = st["tries"].setdefault(nid, [])
    n = len(tries) + 1
    write_atomic(item.dir / "tries" / nid / f"{n}.md", out + "\n")
    write_atomic(item.dir / node["output"], out + "\n")
    tries.append({"n": n, "chars": count_chars(out), "verdict": "做完", "round": st["round"][nid]})  # round: its number within this round
    item.set_node(nid, "done")
    item.note(node["title"], "做完", f"第 {n} 次，{count_chars(out)} 字，用了 {secs} 秒")
    item.save()
    return True


def do_machine_gate(line: dict, node: dict, item: Item):
    """Return the next node id, or None when the item stopped."""
    st, gid, maker = item.st, node["id"], node["on_fail"]
    text = read(item.dir / node["file"])
    if not text.strip():
        problems = [("没有产出", "上一步没有交出文件")]
    elif node["judge"] == "ai":
        item.set_node(gid, "run", since=time.time())
        item.save()
        try:
            problems = judge_ai(line, node, item.dir, text)
        except RuntimeError as e:
            item.set_node(gid, "fail")
            item.note(node["title"], "出错", str(e))
            item.stop(str(e), gid)
            return None
    else:
        problems = judge_machine(node.get("checks", {}), text, item.dir)
    judged, n = st["judged"].setdefault(gid, []), count_chars(text)
    k = len(judged) + 1
    last_try = (st["tries"].get(maker) or [{}])[-1]
    if not problems:
        how = f"AI 质检员按 {len([c for c in node['criteria'].splitlines() if c.strip()])} 条标准看过，" if node["judge"] == "ai" else ""
        judged.append(f"第 {k} 次：合格（{how}{n} 字）")
        last_try["verdict"] = "合格"
        (item.dir / "feedback" / f"{maker}.md").unlink(missing_ok=True)
        item.set_node(gid, "pass")
        item.note(node["title"], "合格", f"{n} 字")
        nxt = next_id(line, gid)
        item.walk(gid, nxt)
        item.save()
        return nxt
    short = "；".join(p[0] for p in problems)
    full = "；".join(p[1] for p in problems) if node["judge"] == "ai" else short  # keep everything the inspector said
    last_try["verdict"] = f"不合格：{full}"
    item.set_node(gid, "fail")
    written = st["round"].get(maker, 0)
    if written >= node["max_tries"]:
        judged.append(f"第 {k} 次：不合格（{n} 字，{full}）。已到上限，停线。")
        item.walk(gid, "stop")
        item.note(node["title"], "停线", f"{written} 次都不合格，没有放到后面去")
        item.stop(f"「{node_map(line)[maker]['title']}」连写 {written} 次都没过「{node['title']}」这道门（最后一次：{short}）。"
                  f"不合格的东西没有流到后面。", maker)
        return None
    judged.append(f"第 {k} 次：不合格（{n} 字，{full}）。已退回重写。")
    write_atomic(item.dir / "feedback" / f"{maker}.md", "\n".join(f"- {p[1]}" for p in problems) + "\n")
    st["back"][f"{gid}>{maker}"] = st["back"].get(f"{gid}>{maker}", 0) + 1
    item.walk(gid, maker)
    item.note(node["title"], "不合格，退回", full)
    item.save()
    return maker


def run_segment(def_path: Path, item_dir: Path, start: str, only: bool = False) -> str:
    item = Item(item_dir)
    item.st.update(state="running", pid=os.getpid(), why=None)
    item.st.pop("resume_from", None)
    item.st.pop("launched", None)
    item.save()
    cur = start
    try:
        line = load_json(def_path)  # read once: a segment finishes under the rules it started with
        while True:
            node = node_map(line)[cur]
            if node["kind"] == "source":
                nxt = next_id(line, cur)
                item.walk(cur, nxt)
                cur = nxt
            elif node["kind"] == "station":
                if not do_station(line, node, item):
                    break
                if only:
                    item.st.update(state="idle", at=cur)
                    item.note(node["title"], "停着", "只重做了这一步，没有往后走")
                    item.save()
                    break
                nxt = next_id(line, cur)
                item.walk(cur, nxt)
                cur = nxt
            elif node["kind"] == "gate" and node["judge"] in ("machine", "ai"):
                item.st["at"] = cur
                cur = do_machine_gate(line, node, item)
                if cur is None:
                    break
            elif node["kind"] == "gate":
                item.st.update(state="waiting", at=cur)
                item.set_node(cur, "wait")
                item.note(node["title"], "等你验收")
                item.save()
                break
            else:  # product
                item.st.update(state="done", at=cur)
                item.set_node(cur, "done")
                item.note(node["title"], "已出货", node["file"])
                item.save()
                break
    except Exception as e:  # never leave an item looking busy after a crash
        traceback.print_exc()
        item.stop(f"执行器出错：{e}", cur if cur else start)
    return item.st["state"]


def decide(line: dict, item_dir: Path, gate_id: str, approve: bool, reason: str = "") -> str:
    """Record the user's verdict at a human gate; return the node to continue from."""
    item, node = Item(item_dir), node_map(line)[gate_id]
    if item.st["state"] != "waiting" or item.st["at"] != gate_id:
        raise ValueError("这件活现在不在等这道门的验收")
    judged, stamp = item.st["judged"].setdefault(gate_id, []), time.strftime("%H:%M:%S")
    last_try = (item.st["tries"].get(node["on_fail"]) or [{}])[-1]  # the attempt the user just looked at
    last_try["verdict"] = "你验收合格" if approve else f"你验收不合格：{reason.strip()}"
    if approve:
        nxt = next_id(line, gate_id)
        judged.append(f"{stamp} 你判了合格")
        item.set_node(gate_id, "pass")
        item.walk(gate_id, nxt)
        item.note(node["title"], "合格", "你点了“合格，出货”")
        product = node_map(line)[nxt]
        if product["kind"] == "product":  # nothing left to run: ship right here, no runner needed
            item.st.update(state="done", at=nxt)
            item.set_node(nxt, "done")
            item.note(product["title"], "已出货", product["file"])
            item.save()
            return None
    else:
        if not reason.strip():
            raise ValueError("不合格要写一句理由，不然它不知道该怎么改")
        nxt = node["on_fail"]
        judged.append(f"{stamp} 你判了不合格：{reason.strip()}")
        item.set_node(gate_id, "fail")
        item.st["back"][f"{gate_id}>{nxt}"] = item.st["back"].get(f"{gate_id}>{nxt}", 0) + 1
        item.walk(gate_id, nxt)
        item.st["round"][nxt] = 0  # a human send-back starts a fresh round for the machine limit
        write_atomic(item.dir / "feedback" / f"{nxt}.md", f"- 人工验收不合格：{reason.strip()}\n")
        item.note(node["title"], "不合格，退回", reason.strip())
    item.st["state"] = "idle"
    item.save()
    return nxt


def prepare_rerun(line: dict, item_dir: Path, start: str) -> None:
    """Reset what lies at and after `start` so a manual rerun shows a clean path."""
    item, flow = Item(item_dir), line["flow"]
    if start not in flow or node_map(line)[start]["kind"] in ("source", "product"):
        raise ValueError("只能从某一站或某一道门开始重做")
    if item.st["state"] == "running" and not runner_dead(item.st):
        raise ValueError("这件活正在做，等它停下再说")
    if item.st["state"] in ("done", "abandoned"):
        raise ValueError("这件活已经结束了。想重做请重新投料，免得盖掉成品")
    later = set(flow[flow.index(start):]) | {"stop"}
    for node_id in later:
        item.st["nodes"].pop(node_id, None)
    item.st["walked"] = [w for w in item.st["walked"] if w.split(">")[0] not in later]
    item.st["round"] = {}
    item.st.update(state="idle", why=None)
    item.st.pop("resume_from", None)
    item.note(node_map(line)[start]["title"], "重做", "你要求从这一步重新开始")
    item.save()


def item_detail(line: dict, item_dir: Path) -> dict:
    item = Item(item_dir)
    st = item.st
    if runner_dead(st):  # the runner died without saying goodbye
        where = st["at"]
        if st["nodes"].get(where, {}).get("state") == "run":
            item.set_node(where, "fail")
        item.stop("运行中断了（电脑重启，或者程序被关掉）。可以从停下的那一步接着跑。", where)
    out = json.loads(json.dumps(st))
    out["state_name"] = STATE_NAMES.get(st["state"], st["state"])
    for node_id, info in out["nodes"].items():
        if info.get("state") == "run" and info.get("since"):
            info["seconds"] = int(time.time() - info["since"])
    for node_id, tries in out["tries"].items():
        for t in tries:
            t["text"] = read(item.dir / "tries" / node_id / f"{t['n']}.md").strip()
    names = {n.get(k) for n in line["nodes"] for k in ("file", "input", "output") if n.get(k)}
    for n in line["nodes"]:  # refs is a list; reference is one name or a list
        ref = n.get("reference") or []
        names |= set(n.get("refs") or []) | set([ref] if isinstance(ref, str) else ref)
    out["files"] = {name: read(item.dir / name).strip() for name in sorted(names) if (item.dir / name).exists()}
    out["folder"] = str(item.dir)
    return out


# ---------- trial runs and AI proposals ----------

def sample_files(line_dir: Path) -> list:
    folder = Path(line_dir) / "sample"
    return sorted(p for p in folder.glob("*.md") if read(p).strip()) if folder.exists() else []

def run_trial(line_dir: Path, def_path: Path, out_dir: Path, runs: int) -> dict:
    """Feed every sample through the definition `runs` times each. Reaching a human gate or the product counts as ok.
    One sample proves little: a line that passes on the material it was designed around may still stop on the next one."""
    line, samples = load_json(def_path), sample_files(line_dir)
    result = {"version": line["version"], "at": now(), "runs": runs * len(samples), "ok": 0, "running": True,
              "details": [], "samples": [], "pid": os.getpid()}
    save_json(out_dir / "result.json", result)
    if not samples:
        result.update(running=False, error="这条线还没有样例原料（sample 文件夹是空的），没法试跑")
        save_json(out_dir / "result.json", result)
        return result
    for sample in samples:
        stat = {"name": sample.stem, "runs": runs, "ok": 0}
        result["samples"].append(stat)
        for i in range(runs):
            item_id = new_item(out_dir / "items", line, read(sample))
            state = run_segment(def_path, out_dir / "items" / item_id, line["flow"][0])
            st = load_json(out_dir / "items" / item_id / "status.json")
            ok, backs = state in ("waiting", "done"), sum(st["back"].values())
            result["ok"] += ok
            stat["ok"] += ok
            label = "没走通" if not ok else f"走通了，中途被退回 {backs} 次" if backs else "走通了，一遍过"
            result["details"].append({"id": item_id, "name": f"样例「{sample.stem}」第 {i + 1} 次", "sample": sample.stem,
                                      "state": state, "state_name": label, "why": st.get("why"), "back": backs, "at": st["at"]})
            save_json(out_dir / "result.json", result)
    result["running"] = False
    save_json(out_dir / "result.json", result)
    return result


DESIGN_RULES = """你是一条产线的设计者。下面是这条线现在的定义（JSON）和使用者的一句意见。请按意见修改定义。

定义的格式：
- flow 是主线顺序，第一个节点 kind 是 source（原料），最后一个是 product（成品）。只支持一条主线加退回，不支持并行。
- station（站）：id、title、input（主要读哪个文件）、output（写哪个文件，名字形如 "30-名字.md"）、spec（写给工人看的说明：这一步做什么、做成什么样）、timeout（秒）；可选 model（这一站单独用的模型，比如 "sonnet"；需要判断力的站用强一点的，照抄整理类的站用线上默认的便宜模型）；可选 refs（还要一并参考的文件名列表，比如原料或更前面某一站的产出）。
- gate（门）且 judge 为 machine：title、file（查哪个文件）、checks（只支持这七项：min_chars、max_chars、single_paragraph、no_preamble、must_include——每一件活的产出里都必须原样出现的固定文字，比如小标题；keep_backticks_from——填一个文件名，那个文件里反引号括起来的内容必须原样出现在产出里；urp_shader——填 true，产出必须是一个能被 Unity URP 接受的 .shader 文件，静态查结构、管线标签、内置管线残留、SRP Batcher 兼容）。门的标准必须对每一件原料都成立，不能把某一份样例里的具体内容写死在标准里、on_fail（不合格退回前面的哪个站）、max_tries（同一件活最多写几次）。程序自动查，不花额度。
- gate 且 judge 为 ai：title、file、criteria（合格标准，一行一条，要具体到能判对错）、on_fail、max_tries；可选 reference（质检时对照哪个文件，默认是 on_fail 那一站的输入文件）。由另一个 AI 读懂内容来判，用于机器查不了的标准，比如“没有编造”“没有漏项”。
- gate 且 judge 为 human：title、file、points（验收要点）、on_fail。
- 能让机器判的不让 AI 判，能让 AI 判的不让人判；人判的门只留给必须由人拿主意的事。
- 一个标准只存一处：字数、格式、内容要求都只写在门上（工人干活时会自动看到后面那道门的标准），站的 spec 里不要重复写。
- 每个站后面应当有一道门。
- 新加或改动的门，标准不能和已有站的规格、别的门的标准互相矛盾；AI 门的 reference 要选它真正该对照的文件（查事实对照原料，查是否忠实于上一步对照上一步的产出）。

规则：
- 只改与意见有关的地方，其余原样保留。
- 不要改这些字段：id、version、approved_version、approved_at、changed_by、changed_at、layout、trial、worker、model、name。
- 新增节点要给一个英文小写的 id，并放进 flow 的正确位置。
- 只输出一个 JSON 对象，不要任何别的文字：{"summary": ["改了什么，一条一句大白话，给不写代码的人看"], "line": {完整的新定义}}
"""


def propose(line_dir: Path, pid: str) -> None:
    """Ask the designer model for a changed definition, validate it, trial it, and leave it for the user to accept."""
    folder = line_dir / "proposals" / pid
    req, line = load_json(folder / "request.json"), load_json(line_dir / "line.json")
    state = {"id": pid, "state": "working", "scope": req["scope"], "text": req["text"], "summary": [], "trial": None,
             "error": None, "base_version": line["version"], "pid": os.getpid()}
    save_json(folder / "state.json", state)
    try:
        target = "整条线" if req["scope"] == "line" else f"节点「{node_map(line)[req['scope']]['title']}」（id: {req['scope']}）"
        prompt = f"{DESIGN_RULES}\n使用者的意见（针对{target}）：{req['text']}\n\n现在的定义：\n{json.dumps(line, ensure_ascii=False, indent=1)}"
        if line.get("worker") == "stub":  # test double: no model call
            new = json.loads(json.dumps(line))
            node = node_map(new)[req["scope"]] if req["scope"] != "line" else next(n for n in new["nodes"] if n["kind"] == "station")
            key = "spec" if node["kind"] == "station" else "points" if node.get("judge") == "human" else None
            if key:
                node[key] = node[key].rstrip() + f"\n（按意见补充：{req['text']}）"
            answer = json.dumps({"summary": [f"在「{node['title']}」里加了一句：{req['text']}"], "line": new}, ensure_ascii=False)
        else:
            answer, err, _ = call_worker(line, prompt, line_dir, 600, model=line.get("designer_model", "sonnet"))
            if answer is None:
                raise ValueError(f"AI 没改成：{err}")
        data = json.loads(answer[answer.index("{"):answer.rindex("}") + 1])
        new = data["line"]
        for key in ("id", "name", "version", "approved_version", "approved_at", "changed_by", "changed_at", "trial", "worker", "model"):
            if key in line:
                new[key] = line[key]
        new["layout"] = {k: v for k, v in line.get("layout", {}).items() if k == "stop" or k in node_map(new)}
        problems = validate_line(new)
        if problems:
            raise ValueError("AI 改出来的线有问题，没有采用：" + "；".join(problems))
        save_json(folder / "line.json", new)
        state["summary"] = [str(s) for s in data.get("summary", [])] or ["AI 没有说明改了什么"]
        save_json(folder / "state.json", state)
        result = run_trial(line_dir, folder / "line.json", folder / "trial", 3 if len(sample_files(line_dir)) < 2 else 2)
        state["trial"] = {"runs": result["runs"], "ok": result["ok"], "error": result.get("error"),
                          "items": result["details"], "samples": result["samples"]}
        state["state"] = "ready"
    except Exception as e:
        traceback.print_exc()
        state.update(state="failed", error=str(e) if isinstance(e, ValueError) else f"AI 的回答看不懂，没有采用（{type(e).__name__}）")
    save_json(folder / "state.json", state)


# ---------- test double ----------

STUB_POINTS = ("- 老城区一栋六层居民楼三年前把闲置楼顶改成菜园\n- 第一年雨季排水口堵塞渗水，菜园险些被拆\n"
               "- 第二年重做防水并定下三条规矩，参与住户增至十一户\n- 第三年菜园成为公共客厅，顶楼夏季室温低两到三度\n"
               "- 冬季闲置、土壤板结和无人接手的箱子仍是问题")
STUB_GOOD = ("老城区一栋居民楼三年前把闲置楼顶改成菜园，最初因排水堵塞渗水险些被拆；重做防水并定下规矩后，"
             "参与住户从两户增至十一户，如今成为楼里的公共客厅，顶楼夏季室温降低两到三度，但冬季闲置和无人接手的箱子仍是问题。")


def stub() -> None:
    """Fake worker: the first summary is too short on purpose; it gets it right only after a send-back."""
    prompt = sys.stdin.read()
    time.sleep(float(os.environ.get("LINE_STUB_DELAY", "0.3")))
    if prompt.startswith("你是质检员"):
        print('{"pass": true, "problems": []}')
    elif "摘要" not in prompt.split("# 输入")[0]:
        print(STUB_POINTS)
    else:
        print(STUB_GOOD if "# 上次被退回的原因" in prompt else "楼顶菜园三年变成公共客厅。")


def main() -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--line", required=True)
    r.add_argument("--item", required=True)
    r.add_argument("--from", dest="start", required=True)
    r.add_argument("--only", action="store_true")
    r.add_argument("--def", dest="definition", default="")
    t = sub.add_parser("trial")
    t.add_argument("--line", required=True)
    t.add_argument("--runs", type=int, default=3)
    t.add_argument("--out", default="")
    a = sub.add_parser("propose")
    a.add_argument("--line", required=True)
    a.add_argument("--id", required=True)
    c = sub.add_parser("check")
    c.add_argument("--line", required=True)
    sub.add_parser("stub")
    args = p.parse_args()
    if args.cmd == "stub":
        stub()
    elif args.cmd == "check":  # for whoever designs a line: can it run, and what is still weak
        line = load_json(Path(args.line) / "line.json")
        problems = validate_line(line)
        nodes, flow = node_map(line), line["flow"]
        weak = [] if problems else [f"「{nodes[a]['title']}」后面还没有门" for a, b in zip(flow, flow[1:])
                                    if nodes[a]["kind"] == "station" and nodes[b]["kind"] != "gate"]
        count = len(sample_files(Path(args.line)))
        if count == 0:
            weak.append("还没有样例原料（sample 文件夹里放 .md 文件），没法试跑")
        elif count == 1:
            weak.append("只有一份样例原料。只在一份样例上走通，证明不了换一份也能走通，至少再放两份不一样的")
        print(json.dumps({"can_run": not problems, "problems": problems, "weak": weak}, ensure_ascii=False, indent=1))
        return 1 if problems else 0
    elif args.cmd == "run":
        line_dir = Path(args.line)
        print(run_segment(Path(args.definition) if args.definition else line_dir / "line.json",
                          line_dir / "items" / args.item, args.start, args.only))
    elif args.cmd == "trial":
        line_dir = Path(args.line)
        out = line_dir / "trials" / (args.out or time.strftime("%Y%m%d-%H%M%S"))
        save_json(line_dir / "trials" / "latest.json", {"dir": out.name})
        print(json.dumps(run_trial(line_dir, line_dir / "line.json", out, args.runs), ensure_ascii=False))
    elif args.cmd == "propose":
        propose(Path(args.line), args.id)
    return 0


if __name__ == "__main__":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
