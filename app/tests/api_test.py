"""End-to-end API test against a line that uses the stub worker (no model quota spent).

Usage: python app/tests/api_test.py <port> <path to sample input>
The line must be fresh: draft, no items. See docs/05-产线文件与接口.md for how to set it up.
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = f"http://127.0.0.1:{sys.argv[1]}/api/"
FAILS = []


def call(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="GET" if body is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))
    if not cond:
        FAILS.append(name)


def wait_item(item_id, states, secs=40):
    for _ in range(secs * 4):
        d = call(f"item/{item_id}")
        if d.get("state") in states:
            return d
        time.sleep(0.25)
    return d


def wait_state(pred, secs=90):
    for _ in range(secs * 4):
        s = call("state")
        if pred(s):
            return s
        time.sleep(0.25)
    return s


def node(state, node_id):
    return next(n for n in state["line"]["nodes"] if n["id"] == node_id)


# ----- draft line: no feeding, approval asks first -----
s = call("state")
check("state loads", s.get("ok") and s["line"]["version"] == 1 and not s["items"], f"v{s['line']['version']}, items {len(s['items'])}")
check("warns about the station without a gate", any("提要点" in w for w in s["line"]["warnings"]), str(s["line"]["warnings"]))
r = call("item", {"text": "一篇测试文章"})
check("feed refused while draft", not r["ok"], r.get("error", ""))
r = call("line/approve", {})
check("approve asks first when untested", not r["ok"] and r.get("need_force") and any("试跑" in c for c in r["concerns"]), r.get("error", ""))
check("trial starts", call("line/trial", {"runs": 2})["ok"])
s = wait_state(lambda s: s["line"]["trial"] and not s["line"]["trial"]["running"])
t = s["line"]["trial"]
check("trial result lists its runs per sample", t and t["runs"] == 2 and t["ok"] == 2 and len(t["items"]) == 2
      and t["samples"] == [{"name": "input", "runs": 2, "ok": 2}] and "中途被退回 1 次" in t["items"][0]["state_name"], str(t))
d = call(f"trial/item/{t['items'][0]['id']}")
check("a trial run can be opened read-only", d.get("ok") and d.get("readonly") and d["tries"]["summarize"][-1]["text"], d.get("state", str(d)))
r = call("line/approve", {})
check("approve still warns: missing gate, single sample", not r["ok"] and r.get("need_force") and any("还没有门" in c for c in r["concerns"])
      and any("一份样例" in c for c in r["concerns"]) and not any("没试跑" in c for c in r["concerns"]), r.get("error", ""))
check("approve with force", call("line/approve", {"force": True})["ok"] and call("state")["line"]["approved_version"] == 1)

# ----- one item: send-back, human reject, reruns, approve -----
r = call("item", {"text": open(sys.argv[2], encoding="utf-8-sig").read(), "title": "测试件"})
check("feed accepted", r["ok"], str(r))
iid = r["id"]
d = wait_item(iid, {"waiting", "stopped"})
check("reaches human gate", d["state"] == "waiting" and d["at"] == "review", f"{d['state']} at {d['at']}")
check("send-back recorded", d["back"].get("gate>summarize") == 1 and len(d["tries"]["summarize"]) == 2,
      str([(x["n"], x["chars"], x["verdict"]) for x in d["tries"]["summarize"]]))
check("every attempt's text kept", d["tries"]["summarize"][0]["text"] != d["tries"]["summarize"][1]["text"])
check("files returned", {"00-input.md", "10-points.md", "20-summary.md"} <= set(d["files"]), str(sorted(d["files"])))
r = call(f"item/{iid}/decide", {"node": "review", "approve": False, "reason": " "})
check("reject without reason refused", not r["ok"], r.get("error", ""))
check("reject with reason", call(f"item/{iid}/decide", {"node": "review", "approve": False, "reason": "太书面"})["ok"])
d = wait_item(iid, {"waiting"})
check("back at human gate after reject", d["at"] == "review" and d["back"].get("review>summarize") == 1, str(d["back"]))
check("rejected attempt shows the user's verdict", d["tries"]["summarize"][1]["verdict"] == "你验收不合格：太书面", d["tries"]["summarize"][1]["verdict"])
check("redo one step only", call(f"item/{iid}/run", {"from": "summarize", "only": True})["ok"])
d = wait_item(iid, {"idle", "stopped"})
check("stops after one step", d["state"] == "idle" and d["at"] == "summarize", f"{d['state']} at {d['at']}")
check("continue from the gate", call(f"item/{iid}/run", {"from": "gate", "only": False})["ok"])
d = wait_item(iid, {"waiting", "stopped"})
check("waiting again", d["state"] == "waiting", d["state"])
check("approve item", call(f"item/{iid}/decide", {"node": "review", "approve": True})["ok"])
d = wait_item(iid, {"done"})
check("shipped", d["state"] == "done" and d["at"] == "out" and d["tries"]["summarize"][-1]["verdict"] == "你验收合格", f"{d['state']} at {d['at']}")
r = call(f"item/{iid}/run", {"from": "summarize", "only": False})
check("rerun refused after shipping", not r["ok"], r.get("error", ""))

# ----- the user's own edit: new version, draft again -----
r = call("line/node", {"id": "gate", "patch": {"checks": {"max_chars": 150}}})
s = call("state")
check("own edit makes a new draft version", r["ok"] and s["line"]["version"] == 2 and s["line"]["approved_version"] is None
      and s["line"]["changed_by"] == "你", f"v{s['line']['version']} approved={s['line']['approved_version']}")
check("history says what changed", s["line"]["history"][0]["current"] and "字数和格式" in s["line"]["history"][0]["note"]
      and len(s["line"]["history"]) == 2, str(s["line"]["history"]))
r = call("line/node", {"id": "gate", "patch": {"checks": {"min_chars": 500}}})
check("bad edit refused", not r["ok"], r.get("error", ""))
r = call("item", {"text": "草稿时再投"})
check("feed refused again after the edit", not r["ok"], r.get("error", ""))

# ----- a draft does no real work, but a finished product can still be shipped -----
call("line/approve", {"force": True})
r = call("item", {"text": open(sys.argv[2], encoding="utf-8-sig").read(), "title": "草稿期间的活"})
jid = r["id"]
d = wait_item(jid, {"waiting", "stopped"})
call("line/node", {"id": "review", "patch": {"points": "看着顺眼就行。"}})   # version 3, draft again
r = call(f"item/{jid}/decide", {"node": "review", "approve": False, "reason": "再短点"})
check("send-back refused on a draft line", not r["ok"] and "草稿" in r.get("error", ""), r.get("error", ""))
r = call(f"item/{jid}/run", {"from": "summarize", "only": False})
check("rerun refused on a draft line", not r["ok"] and "草稿" in r.get("error", ""), r.get("error", ""))
r = call(f"item/{jid}/decide", {"node": "review", "approve": True})
check("shipping a finished product works on a draft line", r["ok"] and call(f"item/{jid}")["state"] == "done", str(r))

# ----- samples: a line is tested against every one of them -----
r = call(f"item/{jid}/sample", {})
s = call("state")
check("an item's material becomes a sample", r["ok"] and [x["name"] for x in s["line"]["samples"]] == ["input", "草稿期间的活"], str(s["line"]["samples"]))
check("add and remove a sample", call("line/sample", {"name": "临时", "text": "一段话"})["ok"] and len(call("state")["line"]["samples"]) == 3
      and call("line/sample/remove", {"name": "临时"})["ok"] and len(call("state")["line"]["samples"]) == 2)
check("trial with two samples", call("line/trial", {})["ok"])
s = wait_state(lambda s: s["line"]["trial"] and not s["line"]["trial"]["running"])
t = s["line"]["trial"]
check("every sample is run", t["runs"] == 4 and t["ok"] == 4 and [(x["name"], x["runs"], x["ok"]) for x in t["samples"]] ==
      [("input", 2, 2), ("草稿期间的活", 2, 2)], str({k: t[k] for k in ("runs", "ok", "samples")}))
call("line/approve", {"force": True})

# ----- AI change: nothing happens until accepted -----
check("ask AI", call("ai", {"scope": "summarize", "text": "口语一点"})["ok"])
r = call("ai", {"scope": "line", "text": "再来一个"})
check("second AI request refused while pending", not r["ok"], r.get("error", ""))
r = call("line/node", {"id": "extract", "patch": {"spec": "手改一句"}})
check("own edit refused while an AI change is pending", not r["ok"], r.get("error", ""))
s = wait_state(lambda s: s["line"]["proposal"] and s["line"]["proposal"]["state"] in ("ready", "failed"))
p = s["line"]["proposal"]
check("proposal ready with trial and the changed line", p["state"] == "ready" and p["trial"]["ok"] == p["trial"]["runs"] == 4
      and len(p["trial"]["items"]) == 4 and p["line"]["flow"], str({k: v for k, v in p.items() if k not in ("line", "trial")}))
d = call(f"proposal/item/{p['trial']['items'][0]['id']}")
check("a proposal's trial run can be opened", d.get("ok") and d.get("readonly"), str(d.get("state")))
spec_before = node(s, "summarize")["spec"]
check("line unchanged before accepting", s["line"]["version"] == 3)
r = call("ai/accept", {})
check("accept AI change", r["ok"] and r["approved"] is True, str(r))
s = call("state")
check("accepted change applied; an approved line stays approved", node(s, "summarize")["spec"] != spec_before and s["line"]["version"] == 4
      and s["line"]["approved_version"] == 4 and s["line"]["proposal"] is None and s["line"]["trial"]
      and "口语一点" in s["line"]["history"][0]["note"], f"v{s['line']['version']} {s['line']['history'][0]['note']}")

# ----- going back to an earlier version -----
check("switch back to version 3", call("line/revert", {"to": 3})["ok"])
s = call("state")
check("version 3's content is back as a new draft", node(s, "summarize")["spec"] == spec_before and s["line"]["version"] == 5
      and s["line"]["approved_version"] is None and "第 3 版" in s["line"]["history"][0]["note"], f"v{s['line']['version']}")

# ----- accepting an AI change does not approve older, unapproved edits -----
check("ask AI on a draft", call("ai", {"scope": "extract", "text": "要点写短一点"})["ok"])
s = wait_state(lambda s: s["line"]["proposal"] and s["line"]["proposal"]["state"] in ("ready", "failed"))
r = call("ai/accept", {})
check("accepting on a draft leaves the line a draft", r["ok"] and r["approved"] is False and call("state")["line"]["approved_version"] is None, str(r))
check("can also reach version 1", call("line/revert", {"to": 1})["ok"] and node(call("state"), "gate")["checks"]["max_chars"] == 120)
check("layout saved", call("line/layout", {"layout": {"in": [10, 20], "stop": [300.4, 400.6]}})["ok"] and call("state")["line"]["layout"]["stop"] == [300, 401])

# ----- hitting the limit stops the line, it does not pass -----
call("line/node", {"id": "gate", "patch": {"checks": {"min_chars": 1, "max_chars": 5}}})
call("line/approve", {"force": True})
r = call("item", {"text": "停线测试"})
d = wait_item(r["id"], {"stopped", "waiting"})
check("stops at limit, not passed", d["state"] == "stopped" and d["at"] == "stop" and d.get("resume_from") == "summarize"
      and len(d["tries"]["summarize"]) == 3, f"{d['state']} why={d.get('why')}")
check("abandon", call(f"item/{r['id']}/abandon", {})["ok"] and call(f"item/{r['id']}")["state"] == "abandoned")
print("\nRESULT:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAILED: {FAILS}")
