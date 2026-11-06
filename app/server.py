#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""QSL 卡片与信封打印程序 — Flask 后端。
数据保存在 DATA_DIR/data.json（默认 <应用目录>/data/data.json），
首次启动时用内置种子数据（app/seed_data.json，247 条通联记录）初始化，
之后重启不再覆盖已有数据。
"""
import io
import json
import os
import re
import threading
import uuid
from datetime import datetime, timedelta

from flask import Flask, jsonify, request, send_file, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE_DIR, "data"))
SEED_PATH = os.path.join(BASE_DIR, "seed_data.json")
DATA_PATH = os.path.join(DATA_DIR, "data.json")
PORT = int(os.environ.get("PORT", "8000"))

app = Flask(__name__, static_folder=os.path.join(BASE_DIR, "static"),
            static_url_path="/static")
_lock = threading.Lock()

# 寄件人默认信息（取自用户 2025 版卡片页脚；QTH 为用户纠正后的 OM72）
DEFAULT_SENDER = {
    "callsign": "BH6AJS",
    "qth": "OM72",
    "cq": "24",
    "itu": "44",
    "address": "安徽省阜阳市颍州区颍州中路158号",
    "postcode": "236019",
    "phone": "13148489408",
    "rig": "FT-710",
    "power": "10",
    "ant": "",
    "name": "",
}


# ---------------------------------------------------------------- 数据层
def _convert_seed(raw):
    """把 ~/workspace/qsl/data.json 的结构转成内部结构。"""
    sender = dict(DEFAULT_SENDER)
    if isinstance(raw.get("sender"), str) and raw["sender"]:
        sender["callsign"] = raw["sender"]
    cards = []
    for i, c in enumerate(raw.get("cards", []), 1):
        cards.append({
            "id": "c%04d" % i,
            "callsign": c.get("callsign", ""),
            "date": c.get("date", ""),
            "time": c.get("time", ""),
            "freq": c.get("freq", ""),
            "mode": c.get("mode", ""),
            "rst": c.get("rst", ""),
            "power": c.get("power", sender["power"]),
            "rig": c.get("rig", sender["rig"]),
            "ant": c.get("ant", ""),
            "rmks": c.get("rmks", ""),
        })
    contacts = {}
    for e in raw.get("envelopes", []):
        cs = e.get("callsign", "")
        if not cs:
            continue
        contacts[cs] = {
            "recipient": e.get("recipient", ""),
            "address": e.get("address", ""),
            "postcode": e.get("postcode", ""),
            "flag": e.get("flag", ""),
        }
    return {"sender": sender, "cards": cards, "contacts": contacts}


def _ensure_data():
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.exists(DATA_PATH):
        return
    if os.path.exists(SEED_PATH):
        with open(SEED_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
        data = _convert_seed(raw)
    else:
        data = {"sender": dict(DEFAULT_SENDER), "cards": [], "contacts": {}}
    _save(data)


def _load():
    _ensure_data()
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DATA_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_PATH)


def _complete(contact):
    return bool(contact and contact.get("recipient") and contact.get("address")
                and contact.get("postcode"))


def _derive(data):
    """由通联记录 + 地址簿派生信封清单与待补地址清单。"""
    counts = {}
    for c in data["cards"]:
        cs = c.get("callsign", "")
        if cs:
            counts[cs] = counts.get(cs, 0) + 1
    envelopes = []
    for cs, ct in data["contacts"].items():
        if _complete(ct):
            envelopes.append({
                "callsign": cs,
                "recipient": ct["recipient"],
                "address": ct["address"],
                "postcode": ct["postcode"],
                "cards": counts.get(cs, 0),
                "flag": ct.get("flag", ""),
            })
    seen = []
    need = []
    for c in data["cards"]:
        cs = c.get("callsign", "")
        if cs and cs not in seen:
            seen.append(cs)
            if not _complete(data["contacts"].get(cs)):
                need.append(cs)
    return envelopes, need


def _public(data):
    envelopes, need = _derive(data)
    return {
        "sender": data["sender"],
        "cards": data["cards"],
        "contacts": data["contacts"],
        "envelopes": envelopes,
        "need_address": need,
        "stats": {
            "cards": len(data["cards"]),
            "envelopes": len(envelopes),
            "need_address": len(need),
        },
    }


def _card_key(card):
    return (card.get("callsign", ""), card.get("date", ""), card.get("time", ""))


# ---------------------------------------------------------------- 页面
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/health")
def health():
    return jsonify({"ok": True})


# ---------------------------------------------------------------- 数据 API
@app.route("/api/data", methods=["GET"])
def api_data():
    with _lock:
        return jsonify(_public(_load()))


@app.route("/api/sender", methods=["GET", "PUT"])
def api_sender():
    with _lock:
        data = _load()
        if request.method == "PUT":
            body = request.get_json(force=True, silent=True) or {}
            for k in DEFAULT_SENDER:
                if k in body:
                    data["sender"][k] = str(body[k])
            _save(data)
        return jsonify(data["sender"])


@app.route("/api/cards", methods=["POST"])
def api_add_card():
    body = request.get_json(force=True, silent=True) or {}
    if not body.get("callsign"):
        return jsonify({"error": "callsign 必填"}), 400
    with _lock:
        data = _load()
        card = {
            "id": uuid.uuid4().hex[:8],
            "callsign": str(body.get("callsign", "")).strip().upper(),
            "date": str(body.get("date", "")),
            "time": str(body.get("time", "")),
            "freq": str(body.get("freq", "")),
            "mode": str(body.get("mode", "")),
            "rst": str(body.get("rst", "")),
            "power": str(body.get("power", data["sender"].get("power", "10"))),
            "rig": str(body.get("rig", data["sender"].get("rig", "FT-710"))),
            "ant": str(body.get("ant", "")),
            "rmks": str(body.get("rmks", "")),
        }
        data["cards"].append(card)
        _save(data)
        return jsonify(card), 201


@app.route("/api/cards/<cid>", methods=["PUT", "DELETE"])
def api_card(cid):
    with _lock:
        data = _load()
        idx = next((i for i, c in enumerate(data["cards"]) if c["id"] == cid), None)
        if idx is None:
            return jsonify({"error": "not found"}), 404
        if request.method == "DELETE":
            data["cards"].pop(idx)
            _save(data)
            return jsonify({"ok": True})
        body = request.get_json(force=True, silent=True) or {}
        for k in ("callsign", "date", "time", "freq", "mode", "rst",
                  "power", "rig", "ant", "rmks"):
            if k in body:
                data["cards"][idx][k] = str(body[k])
        _save(data)
        return jsonify(data["cards"][idx])


@app.route("/api/contacts", methods=["GET", "POST"])
def api_contacts():
    with _lock:
        data = _load()
        if request.method == "POST":
            body = request.get_json(force=True, silent=True) or {}
            cs = str(body.get("callsign", "")).strip().upper()
            if not cs:
                return jsonify({"error": "callsign 必填"}), 400
            data["contacts"][cs] = {
                "recipient": str(body.get("recipient", "")),
                "address": str(body.get("address", "")),
                "postcode": str(body.get("postcode", "")),
                "flag": str(body.get("flag", "")),
            }
            _save(data)
            return jsonify({cs: data["contacts"][cs]}), 201
        return jsonify(data["contacts"])


@app.route("/api/contacts/<callsign>", methods=["PUT", "DELETE"])
def api_contact(callsign):
    cs = callsign.strip().upper()
    with _lock:
        data = _load()
        if request.method == "DELETE":
            data["contacts"].pop(cs, None)
            _save(data)
            return jsonify({"ok": True})
        body = request.get_json(force=True, silent=True) or {}
        ct = data["contacts"].get(cs, {"recipient": "", "address": "",
                                       "postcode": "", "flag": ""})
        for k in ("recipient", "address", "postcode", "flag"):
            if k in body:
                ct[k] = str(body[k])
        data["contacts"][cs] = ct
        _save(data)
        return jsonify({cs: ct})


# ---------------------------------------------------------------- ADIF
TAG_RE = re.compile(r"<([A-Za-z0-9_]+):(\d+)(?::[^>]*)?>([^<]*)", re.I)


def parse_adif(text):
    m = re.search(r"<EOH>", text, re.I)
    body = text[m.end():] if m else text
    records = []
    for chunk in re.split(r"<EOR>", body, flags=re.I):
        if "<CALL:" not in chunk.upper():
            continue
        f = {mm.group(1).upper(): mm.group(3).strip()
             for mm in TAG_RE.finditer(chunk)}
        call = f.get("CALL", "")
        if not call:
            continue
        d = f.get("QSO_DATE", "")
        if len(d) == 8 and d.isdigit():
            date = "%s/%s/%s" % (d[0:4], d[4:6], d[6:8])
        else:
            date = d
        t = f.get("TIME_ON", "")
        time = "%s:%s" % (t[0:2], t[2:4]) if len(t) >= 4 else t
        records.append({
            "callsign": call,
            "date": date,
            "time": time,
            "freq": f.get("FREQ", ""),
            "band": f.get("BAND", ""),
            "mode": f.get("MODE", ""),
            "submode": f.get("SUBMODE", ""),
            "rst_sent": f.get("RST_SENT", ""),
            "rst": f.get("RST_RCVD", ""),
            "name": f.get("NAME", ""),
            "qth": f.get("QTH", ""),
            "gridsquare": f.get("GRIDSQUARE", ""),
            "comment": f.get("COMMENT", ""),
        })
    return records


@app.route("/api/adif/parse", methods=["POST"])
def api_adif_parse():
    if "file" not in request.files:
        return jsonify({"error": "未上传文件"}), 400
    raw = request.files["file"].read()
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        return jsonify({"error": "文件无法按文本读取"}), 400
    records = parse_adif(text)
    with _lock:
        data = _load()
        existing = {_card_key(c) for c in data["cards"]}
    seen = {}
    for i, r in enumerate(records):
        key = (r["callsign"], r["date"], r["time"])
        r["dup_in_file"] = key in seen
        r["dup_first_index"] = seen.get(key)
        if key not in seen:
            seen[key] = i
        r["already_in_table"] = key in existing
        r["has_address"] = _complete(data["contacts"].get(r["callsign"]))
    return jsonify({
        "total": len(records),
        "records": records,
        "dup_groups": len(records) - len(seen),
    })


@app.route("/api/adif/import", methods=["POST"])
def api_adif_import():
    body = request.get_json(force=True, silent=True) or {}
    records = body.get("records", [])
    if not isinstance(records, list):
        return jsonify({"error": "records 应为数组"}), 400
    with _lock:
        data = _load()
        existing = {_card_key(c) for c in data["cards"]}
        added, skipped = 0, 0
        for r in records:
            card = {
                "id": uuid.uuid4().hex[:8],
                "callsign": str(r.get("callsign", "")).strip().upper(),
                "date": str(r.get("date", "")),
                "time": str(r.get("time", "")),
                "freq": str(r.get("freq", "")),
                "mode": str(r.get("mode", "")),
                "rst": str(r.get("rst", "")),
                "power": str(r.get("power", data["sender"].get("power", "10"))),
                "rig": str(r.get("rig", data["sender"].get("rig", "FT-710"))),
                "ant": str(r.get("ant", "")),
                "rmks": str(r.get("comment", "")),
            }
            if not card["callsign"]:
                skipped += 1
                continue
            if _card_key(card) in existing:
                skipped += 1
                continue
            existing.add(_card_key(card))
            data["cards"].append(card)
            added += 1
        _save(data)
        return jsonify({"added": added, "skipped": skipped})


# ---------------------------------------------------------------- Word 导出
def _add_card_table_2025(doc, card, sender, tz):
    from docx.shared import Pt, Cm
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    doc.add_paragraph("TO RADIO: %s" % card["callsign"]).runs[0].bold = True
    t = doc.add_table(rows=4, cols=5)
    t.style = "Table Grid"
    headers1 = ["DATE 日期", "TIME 时间", "QTH 位置", "FREQ 频率", "RST 信号报告"]
    vals1 = [card["date"], _fmt_time(card, tz), sender["qth"], card["freq"], card["rst"]]
    headers2 = ["MODE 模式", "RIG 设备", "PWR 功率", "ANT 天线", "RMKS 备注"]
    vals2 = [card["mode"], card["rig"], card["power"], card.get("ant", ""), card.get("rmks", "")]
    for j, h in enumerate(headers1):
        t.cell(0, j).text = h
    for j, v in enumerate(vals1):
        t.cell(1, j).text = v
    for j, h in enumerate(headers2):
        t.cell(2, j).text = h
    for j, v in enumerate(vals2):
        t.cell(3, j).text = v
    doc.add_paragraph("CQ: %s  ITU: %s    %s  邮编：%s  电话：%s" % (
        sender["cq"], sender["itu"], sender["address"],
        sender["postcode"], sender["phone"]))


def _add_card_table_2024(doc, card, sender, tz):
    t = doc.add_table(rows=4, cols=5)
    t.style = "Table Grid"
    headers1 = ["日期/DATE", "时间/TIME", "频率/BAND", "模式/MODE", "信号报告/RST"]
    mode_marks = {"FM": "☐", "AM": "☐", "SSB": "☐", "CW": "☐", "FT8": "☐"}
    if card["mode"] in mode_marks:
        mode_marks[card["mode"]] = "☑"
    vals1 = [card["date"],
             "%s  %s UTC  %s BJT" % (_fmt_time(card, tz),
                                    "☑" if tz == "UTC" else "☐",
                                    "☑" if tz == "BJT" else "☐"),
             "%s Mhz" % card["freq"],
             " ".join("%s%s" % (v, k) for k, v in mode_marks.items()),
             card["rst"]]
    headers2 = ["设备/RIG", "天线/ANT", "功率/PWR", "备注/RMKS", ""]
    vals2 = [card["rig"], card.get("ant", ""), "%s WATTS" % card["power"],
             card.get("rmks", ""), ""]
    for j, h in enumerate(headers1):
        t.cell(0, j).text = h
    for j, v in enumerate(vals1):
        t.cell(1, j).text = v
    for j, h in enumerate(headers2):
        t.cell(2, j).text = h
    for j, v in enumerate(vals2):
        t.cell(3, j).text = v
    doc.add_paragraph("TO RADIO: %s    QTH: %s    CQ: %s  ITU: %s" % (
        card["callsign"], sender["qth"], sender["cq"], sender["itu"]))


def _fmt_time(card, tz):
    """种子时间是 UTC；BJT = UTC+8（日期可能进位）。"""
    t = card.get("time", "")
    d = card.get("date", "")
    if tz != "BJT" or not t or ":" not in t:
        return t
    try:
        dt = datetime.strptime("%s %s" % (d, t), "%Y/%m/%d %H:%M") + timedelta(hours=8)
        return dt.strftime("%H:%M")
    except Exception:
        return t


@app.route("/api/export/docx", methods=["POST"])
def api_export_docx():
    from docx import Document
    from docx.shared import Pt
    body = request.get_json(force=True, silent=True) or {}
    version = body.get("version", "2025")
    tz = body.get("tz", "BJT")
    card_ids = set(body.get("card_ids", []))
    env_ids = set(body.get("envelope_ids", []))
    with _lock:
        data = _load()
    sender = data["sender"]
    cards = [c for c in data["cards"] if not card_ids or c["id"] in card_ids]
    envelopes, _ = _derive(data)
    envs = [e for e in envelopes if not env_ids or e["callsign"] in env_ids]

    doc = Document()
    for s in doc.sections:
        s.top_margin = Pt(36)
        s.bottom_margin = Pt(36)
    doc.add_heading("QSL 卡片（%s版）" % version, level=1)
    for c in cards:
        if version == "2024":
            _add_card_table_2024(doc, c, sender, tz)
        else:
            _add_card_table_2025(doc, c, sender, tz)
        doc.add_paragraph("")
    doc.add_heading("信封", level=1)
    for e in envs:
        t = doc.add_table(rows=4, cols=1)
        t.style = "Table Grid"
        t.cell(0, 0).text = "邮编：%s" % e["postcode"]
        t.cell(1, 0).text = "收信人地址：%s" % e["address"]
        t.cell(2, 0).text = "收信人：%s" % e["recipient"]
        t.cell(3, 0).text = "寄件人：%s  %s  邮编：%s" % (
            sender["callsign"], sender["address"], sender["postcode"])
        doc.add_paragraph("")
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return send_file(buf, as_attachment=True,
                     download_name="QSL卡片信封.docx",
                     mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


if __name__ == "__main__":
    _ensure_data()
    print("QSL 打印程序启动：http://0.0.0.0:%d  数据：%s" % (PORT, DATA_PATH))
    app.run(host="0.0.0.0", port=PORT)
