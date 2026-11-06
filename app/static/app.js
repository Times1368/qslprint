/* QSL 卡片与信封打印 — 前端逻辑 */
let DATA = null;            // 后端 /api/data 返回的完整数据
let version = "2025";       // 卡片版式
let tz = "BJT";             // UTC / BJT（默认北京时间）
let cardSel = new Set();    // 选中的卡片 id
let envSel = new Set();     // 选中的信封呼号
let cardPage = 1;
const CARD_PER_PAGE = 12;
let envSize = localStorage.getItem("qsl-env-size") || "C5";
const ENV_SIZES = { DL: [220, 110], C5: [229, 162], C6: [162, 114], B6: [176, 125] };
let adifRecords = [];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => { t.style.display = "none"; }, 2500);
}
/* QRZ 快速查地址：统一转大写，在新标签页打开对应呼号主页 */
function qrzUrl(call) {
  return "https://www.qrz.com/db/" + String(call || "").trim().toUpperCase();
}
function qrzBtn(call) {
  return '<a class="btn ghost" style="padding:3px 9px" href="' + qrzUrl(call) +
    '" target="_blank" rel="noopener">查地址</a>';
}
/* 种子时间是 UTC；BJT = UTC+8，日期可能进位 */
function convTime(dateStr, timeStr) {
  if (tz !== "BJT" || !timeStr || timeStr.indexOf(":") < 0) return { date: dateStr, time: timeStr };
  const p = (dateStr || "").split("/");
  const tp = timeStr.split(":");
  if (p.length !== 3) return { date: dateStr, time: timeStr };
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], +tp[0], +tp[1] || 0));
  d.setUTCHours(d.getUTCHours() + 8);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: d.getUTCFullYear() + "/" + pad(d.getUTCMonth() + 1) + "/" + pad(d.getUTCDate()),
    time: pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()),
  };
}

async function api(path, method, body) {
  const opt = { method: method || "GET" };
  if (body !== undefined) {
    opt.headers = { "Content-Type": "application/json" };
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  if (!r.ok) throw new Error("请求失败 " + r.status);
  return r.json();
}

async function loadData() {
  DATA = await api("/api/data");
  $("#statLine").textContent =
    "卡片 " + DATA.stats.cards + " 张 · 信封 " + DATA.stats.envelopes + " 个 · 待补地址 " + DATA.stats.need_address + " 个";
  renderCards();
  renderEnvs();
  renderDataTab();
}

/* ================= 标签页 ================= */
document.querySelectorAll("nav.tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("nav.tabs button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    ["cards", "envs", "data", "adif"].forEach((t) => {
      $("#tab-" + t).style.display = t === b.dataset.tab ? "" : "none";
    });
  });
});

/* ================= 卡片 ================= */
function cardHTML(c, print) {
  const s = DATA.sender;
  const t = convTime(c.date, c.time);
  const ed = print ? "" : ' contenteditable="true" data-id="' + c.id + '"';
  const cell = (field, val) =>
    '<td' + ed + ' data-field="' + field + '">' + esc(val) + "</td>";
  const check = print ? "" :
    '<input type="checkbox" class="card-check" data-id="' + c.id + '"' +
    (cardSel.has(c.id) ? " checked" : "") + ">";
  const toRadio = print
    ? '<div class="to-radio">' + esc(c.callsign) + "</div>"
    : '<div class="to-radio"><span class="lbl">TO RADIO:</span><br>' + esc(c.callsign) + "</div>";
  const ourQso = "☑OUR QSO";
  let table = "";
  if (version === "2025") {
    table = '<table class="qsl-table"><tr><th>DATE 日期</th><th>TIME 时间</th><th>QTH 位置</th><th>FREQ 频率</th><th>RST 信号报告</th></tr><tr>' +
      "<td>" + esc(t.date) + "</td><td>" + esc(t.time) + "</td><td>" + esc(s.qth) + "</td>" +
      cell("freq", c.freq) + cell("rst", c.rst) + "</tr>" +
      '<tr><th>MODE 模式</th><th>RIG 设备</th><th>PWR 功率</th><th>ANT 天线</th><th>RMKS 备注</th></tr><tr>' +
      cell("mode", c.mode) + cell("rig", c.rig) + cell("power", c.power) +
      cell("ant", c.ant || "") + cell("rmks", c.rmks || "") + "</tr></table>";
  } else {
    const modes = ["FM", "AM", "SSB", "CW", "FT8"];
    const modeCell = modes.map((m) =>
      '<span class="mini-cb">' + (c.mode === m ? "<b>☑" + m + "</b>" : "☐" + m) + "</span>").join(" ") +
      ' <span class="mini-cb">' + (c.mode && modes.indexOf(c.mode) < 0 ? "<b>☑" + esc(c.mode) + "</b>" : "☐____") + "</span>";
    table = '<table class="qsl-table"><tr><th>日期/DATE</th><th>时间/TIME</th><th>频率/BAND</th><th>模式/MODE</th><th>信号报告/RST</th></tr><tr>' +
      "<td>" + esc(t.date) + "</td>" +
      '<td><span class="mini-cb">' + (tz === "UTC" ? "<b>☑UTC</b>" : "☐UTC") + "</span><br>" +
      '<span class="mini-cb">' + (tz === "BJT" ? "<b>☑BJT</b>" : "☐BJT") + "</span> " + esc(t.time) + "</td>" +
      '<td' + ed + ' data-field="freq">' + esc(c.freq) + ' <span style="color:#999">Mhz</span></td>' +
      "<td>" + modeCell + "</td>" + cell("rst", c.rst) + "</tr>" +
      '<tr><th>设备/RIG</th><th>天线/ANT</th><th>功率/PWR</th><th colspan="2">备注/RMKS</th></tr><tr>' +
      cell("rig", c.rig) + cell("ant", c.ant || "") +
      '<td' + ed + ' data-field="power">' + esc(c.power) + ' <span style="color:#999">WATTS</span></td>' +
      '<td colspan="2"' + ed + ' data-field="rmks">' + esc(c.rmks || "") + "</td></tr></table>";
  }
  const footAddr = version === "2025"
    ? esc(s.address) + "<br>邮编：" + esc(s.postcode) + "&nbsp;&nbsp;电话：" + esc(s.phone)
    : "扫描二维码获取我的收信地址<br>Scan the QR code to get my mailing address.";
  return '<div class="card-wrap">' + check +
    '<div class="card-head"><img class="logo" src="/static/logo.png" alt="CRAC">' +
    '<div class="card-title"><div class="cn">中国业余无线电台</div>' +
    '<div class="en">AMATEUR RADIO STATION OF P.R. CHINA</div>' +
    '<div class="call">' + esc(s.callsign) + "</div>" +
    '<div class="morse">—...&nbsp;&nbsp;....&nbsp;&nbsp;—...&nbsp;&nbsp;.—&nbsp;&nbsp;.——&nbsp;&nbsp;...</div></div>' +
    '<div class="card-right"><div class="cb">' + ourQso + '<br>☐YOUR SWL REPORT</div>' + toRadio + "</div></div>" +
    table +
    '<div class="card-foot"><img class="qr" src="/static/qr.png" alt="QR">' +
    '<div class="addr">CQ：' + esc(s.cq) + "&nbsp;&nbsp;ITU：" + esc(s.itu) +
    (version === "2024" ? "&nbsp;&nbsp;QTH：" + esc(s.qth) : "") + "<br>" + footAddr + "</div>" +
    '<div class="right">☐TNX谢谢您的卡片 ☐PSE 请回卡片<br>VY 73！/通联愉快！<div class="op">OP/签名：</div></div></div>' +
    "</div>";
}

function renderCards() {
  const total = DATA.cards.length;
  const pages = Math.max(1, Math.ceil(total / CARD_PER_PAGE));
  if (cardPage > pages) cardPage = pages;
  const slice = DATA.cards.slice((cardPage - 1) * CARD_PER_PAGE, cardPage * CARD_PER_PAGE);
  $("#cardList").innerHTML = slice.map((c) => cardHTML(c, false)).join("");
  $("#cardCount").textContent = "共 " + total + " 张 · 已选 " + cardSel.size + " 张 · 第 " + cardPage + "/" + pages + " 页";
  let pg = "";
  for (let i = 1; i <= pages; i++) {
    pg += '<button data-p="' + i + '" class="' + (i === cardPage ? "on" : "") + '">' + i + "</button>";
  }
  $("#cardPager").innerHTML = pg;
  $("#cardPager").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { cardPage = +b.dataset.p; renderCards(); }));
  document.querySelectorAll("#cardList .card-check").forEach((cb) =>
    cb.addEventListener("change", () => {
      if (cb.checked) cardSel.add(cb.dataset.id); else cardSel.delete(cb.dataset.id);
      renderCards();
    }));
  document.querySelectorAll("#cardList [contenteditable]").forEach((td) =>
    td.addEventListener("blur", async () => {
      const val = td.textContent.trim();
      const body = {};
      body[td.dataset.field] = val;
      try {
        await api("/api/cards/" + td.dataset.id, "PUT", body);
        const c = DATA.cards.find((x) => x.id === td.dataset.id);
        if (c) c[td.dataset.field] = val;
        toast("已保存");
      } catch (e) { toast("保存失败：" + e.message); }
    }));
}

$("#verSeg").querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => {
    version = b.dataset.ver;
    $("#verSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    renderCards();
  }));
$("#tzSeg").querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => {
    tz = b.dataset.tz;
    $("#tzSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    renderCards();
  }));
$("#cardSelAll").addEventListener("click", () => {
  DATA.cards.forEach((c) => cardSel.add(c.id));
  renderCards();
});
$("#cardSelNone").addEventListener("click", () => { cardSel.clear(); renderCards(); });

function selectedCards() {
  return DATA.cards.filter((c) => cardSel.size === 0 || cardSel.has(c.id));
}
$("#cardPrint").addEventListener("click", () => {
  const list = selectedCards();
  if (!list.length) { toast("没有可打印的卡片"); return; }
  setPageStyle("@page { size: A4; margin: 8mm; }");
  $("#printArea").innerHTML = list.map((c) =>
    '<div class="print-card">' + cardHTML(c, true) + "</div>").join("");
  window.print();
});
$("#cardDocx").addEventListener("click", async () => {
  const ids = cardSel.size ? [...cardSel] : [];
  await downloadDocx({ version, tz, card_ids: ids, envelope_ids: [] });
});
async function downloadDocx(payload) {
  try {
    const r = await fetch("/api/export/docx", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error("导出失败 " + r.status);
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "QSL卡片信封.docx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("Word 已导出");
  } catch (e) { toast(e.message); }
}

/* ================= 信封 ================= */
function envFaceHTML(e, print) {
  const [w, h] = ENV_SIZES[envSize];
  const scale = print ? 1 : 560 / w;   // 屏幕按宽 560px 缩放显示
  const style = print
    ? 'style="width:' + w + 'mm;height:' + h + 'mm"'
    : 'style="width:' + Math.round(w * scale) + 'px;height:' + Math.round(h * scale) + 'px;font-size:' + (13 * scale + 6) + 'px"';
  const check = print ? "" :
    '<input type="checkbox" class="env-check" data-cs="' + esc(e.callsign) + '"' +
    (envSel.has(e.callsign) ? " checked" : "") + ">";
  const pc = String(e.postcode || "").padEnd(6, " ").split("").slice(0, 6)
    .map((d) => "<span>" + esc(d.trim()) + "</span>").join("");
  const stamp = print ? "" : '<div class="env-stamp">邮资区<br>（打印留空）</div>';
  const flag = e.flag ? '<div class="env-flag">⚠ ' + esc(e.flag) + "</div>" : "";
  return '<div class="env-face" ' + style + ">" + check +
    '<div class="env-postcode">' + pc + "</div>" + stamp +
    '<div class="env-recv-addr">' + esc(e.address) + "</div>" +
    '<div class="env-recv-name">' + esc(e.recipient) + "</div>" +
    '<div class="env-sender">' + esc(DATA.sender.callsign) + "<br>" + esc(DATA.sender.address) +
    "<br>邮编：" + esc(DATA.sender.postcode) + "（内附 QSL 卡片）</div>" + flag + "</div>";
}
function renderEnvs() {
  $("#envSizeSeg").querySelectorAll("button").forEach((b) =>
    b.classList.toggle("on", b.dataset.size === envSize));
  const list = DATA.envelopes;
  $("#envCount").textContent = "共 " + list.length + " 个 · 已选 " + envSel.size + " 个 · 规格 " + envSize + " " + ENV_SIZES[envSize].join("×") + "mm";
  $("#envList").innerHTML = list.map((e) =>
    '<div style="display:flex;gap:8px;align-items:flex-start"><div style="width:130px;padding-top:8px;font-size:14px">' +
    "<b>" + esc(e.callsign) + "</b> " + qrzBtn(e.callsign) +
    (e.flag ? '<br><span class="badge warn">请核对</span>' : "") + "</div>" +
    '<div style="flex:1">' + envFaceHTML(e, false) + "</div></div>").join("");
  document.querySelectorAll("#envList .env-check").forEach((cb) =>
    cb.addEventListener("change", () => {
      if (cb.checked) envSel.add(cb.dataset.cs); else envSel.delete(cb.dataset.cs);
      renderEnvs();
    }));
}
$("#envSizeSeg").querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => {
    envSize = b.dataset.size;
    localStorage.setItem("qsl-env-size", envSize);
    renderEnvs();
  }));
$("#envSelAll").addEventListener("click", () => {
  DATA.envelopes.forEach((e) => envSel.add(e.callsign));
  renderEnvs();
});
$("#envSelNone").addEventListener("click", () => { envSel.clear(); renderEnvs(); });
function setPageStyle(css) {
  let st = document.getElementById("pageStyle");
  if (!st) {
    st = document.createElement("style");
    st.id = "pageStyle";
    document.head.appendChild(st);
  }
  st.textContent = css;
}
$("#envPrint").addEventListener("click", () => {
  const list = DATA.envelopes.filter((e) => envSel.size === 0 || envSel.has(e.callsign));
  if (!list.length) { toast("没有可打印的信封"); return; }
  const [w, h] = ENV_SIZES[envSize];
  setPageStyle("@page { size: " + w + "mm " + h + "mm; margin: 0; }");
  $("#printArea").innerHTML = list.map((e) =>
    '<div class="print-env" style="width:' + w + 'mm;height:' + h + 'mm">' +
    envFaceHTML(e, true).replace(/^<div class="env-face"[^>]*>/, "")).join("");
  window.print();
});
$("#envDocx").addEventListener("click", async () => {
  const ids = envSel.size ? [...envSel] : [];
  await downloadDocx({ version, tz, card_ids: [], envelope_ids: ids });
});

/* ================= 数据页 ================= */
function renderDataTab() {
  const s = DATA.sender;
  const sf = $("#senderForm");
  ["callsign", "qth", "cq", "itu", "address", "postcode", "phone", "rig", "power"].forEach((k) => {
    if (sf.elements[k]) sf.elements[k].value = s[k] || "";
  });
  // 待补地址
  $("#needCount").textContent = DATA.need_address.length;
  $("#needList").innerHTML = DATA.need_address.map((cs) =>
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid #eee">' +
    "<b style=\"min-width:80px\">" + esc(cs) + "</b> " + qrzBtn(cs) +
    '<form class="inline need-form" data-cs="' + esc(cs) + '" style="margin:0;padding:6px">' +
    '<input name="recipient" placeholder="收信人" size="14">' +
    '<input name="address" placeholder="收信地址" size="36">' +
    '<input name="postcode" placeholder="邮编" size="8">' +
    '<button class="btn" type="submit">保存地址</button></form></div>').join("") ||
    '<p class="hint">没有待补地址的呼号，信封已齐全。</p>';
  document.querySelectorAll(".need-form").forEach((f) =>
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const cs = f.dataset.cs;
      const body = {
        callsign: cs,
        recipient: f.recipient.value.trim(),
        address: f.address.value.trim(),
        postcode: f.postcode.value.trim(),
      };
      if (!body.address || !body.postcode) { toast("地址和邮编都要填"); return; }
      try {
        await api("/api/contacts", "POST", body);
        toast(cs + " 地址已保存");
        await loadData();
      } catch (e) { toast("保存失败：" + e.message); }
    }));
  // 通联记录表
  $("#cardTotal").textContent = DATA.cards.length;
  $("#cardTable tbody").innerHTML = DATA.cards.map((c) =>
    "<tr data-id=\"" + c.id + "\"><td><b>" + esc(c.callsign) + "</b> " + qrzBtn(c.callsign) + "</td>" +
    "<td>" + esc(c.date) + "</td><td>" + esc(c.time) + "</td><td>" + esc(c.freq) + "</td>" +
    "<td>" + esc(c.mode) + "</td><td>" + esc(c.rst) + "</td><td>" + esc(c.rig) + "</td>" +
    "<td>" + esc(c.power) + "</td>" +
    '<td><button class="btn ghost" data-act="edit">修改</button> ' +
    '<button class="btn danger" data-act="del">删除</button></td></tr>').join("");
  document.querySelectorAll("#cardTable tbody tr").forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => editCardRow(tr, id));
    tr.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm("确定删除这条通联记录吗？")) return;
      await api("/api/cards/" + id, "DELETE");
      cardSel.delete(id);
      toast("已删除");
      await loadData();
    });
  });
  // 地址簿
  const contacts = Object.entries(DATA.contacts);
  $("#contactTotal").textContent = contacts.length;
  $("#contactTable tbody").innerHTML = contacts.map(([cs, ct]) =>
    "<tr data-cs=\"" + esc(cs) + "\"><td><b>" + esc(cs) + "</b> " + qrzBtn(cs) + "</td>" +
    "<td>" + esc(ct.recipient) + "</td><td>" + esc(ct.address) + "</td>" +
    "<td>" + esc(ct.postcode) + "</td><td>" + esc(ct.flag || "") + "</td>" +
    '<td><button class="btn ghost" data-act="edit">修改</button> ' +
    '<button class="btn danger" data-act="del">删除</button></td></tr>').join("");
  document.querySelectorAll("#contactTable tbody tr").forEach((tr) => {
    const cs = tr.dataset.cs;
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => editContactRow(tr, cs));
    tr.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm("确定删除 " + cs + " 的收信地址吗？")) return;
      await api("/api/contacts/" + cs, "DELETE");
      toast("已删除");
      await loadData();
    });
  });
}
function editCardRow(tr, id) {
  const c = DATA.cards.find((x) => x.id === id);
  if (!c) return;
  const fields = ["callsign", "date", "time", "freq", "mode", "rst", "rig", "power"];
  tr.innerHTML = fields.map((f) =>
    '<td><input data-f="' + f + '" value="' + esc(c[f] || "") + '" size="8"></td>').join("") +
    '<td><button class="btn" data-act="save">保存</button> ' +
    '<button class="btn ghost" data-act="cancel">取消</button></td>';
  tr.querySelector('[data-act="save"]').addEventListener("click", async () => {
    const body = {};
    tr.querySelectorAll("input").forEach((i) => { body[i.dataset.f] = i.value.trim(); });
    await api("/api/cards/" + id, "PUT", body);
    toast("已保存");
    await loadData();
  });
  tr.querySelector('[data-act="cancel"]').addEventListener("click", () => renderDataTab());
}
function editContactRow(tr, cs) {
  const ct = DATA.contacts[cs] || {};
  tr.innerHTML = "<td><b>" + esc(cs) + "</b></td>" +
    '<td><input data-f="recipient" value="' + esc(ct.recipient || "") + '"></td>' +
    '<td><input data-f="address" value="' + esc(ct.address || "") + '"></td>' +
    '<td><input data-f="postcode" value="' + esc(ct.postcode || "") + '"></td>' +
    "<td>" + esc(ct.flag || "") + "</td>" +
    '<td><button class="btn" data-act="save">保存</button> ' +
    '<button class="btn ghost" data-act="cancel">取消</button></td>';
  tr.querySelector('[data-act="save"]').addEventListener("click", async () => {
    const body = { callsign: cs };
    tr.querySelectorAll("input").forEach((i) => { body[i.dataset.f] = i.value.trim(); });
    await api("/api/contacts/" + cs, "PUT", body);
    toast("已保存");
    await loadData();
  });
  tr.querySelector('[data-act="cancel"]').addEventListener("click", () => renderDataTab());
}
$("#senderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {};
  new FormData(e.target).forEach((v, k) => { body[k] = v.trim(); });
  await api("/api/sender", "PUT", body);
  toast("寄件人信息已保存");
  await loadData();
});
$("#addCardForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {};
  new FormData(e.target).forEach((v, k) => { body[k] = v.trim(); });
  try {
    await api("/api/cards", "POST", body);
    e.target.reset();
    toast("已新增通联记录");
    await loadData();
  } catch (err) { toast("新增失败：" + err.message); }
});
$("#addContactForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {};
  new FormData(e.target).forEach((v, k) => { body[k] = v.trim(); });
  try {
    await api("/api/contacts", "POST", body);
    e.target.reset();
    toast("地址已保存");
    await loadData();
  } catch (err) { toast("保存失败：" + err.message); }
});
/* QRZ 快速搜索：输入呼号 → 新标签页打开其 QRZ 主页 */
$("#qrzSearchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const call = $("#qrzSearchInput").value.trim().toUpperCase();
  if (!call) { toast("请先输入呼号"); return; }
  window.open(qrzUrl(call), "_blank", "noopener");
});

/* ================= ADIF 导入 ================= */
$("#adifForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("#adifFile").files[0];
  if (!file) { toast("请先选择 .adi / .adif 文件"); return; }
  const fd = new FormData();
  fd.append("file", file);
  try {
    const r = await fetch("/api/adif/parse", { method: "POST", body: fd });
    const res = await r.json();
    if (!r.ok) throw new Error(res.error || ("解析失败 " + r.status));
    adifRecords = res.records;
    const dups = res.records.filter((x) => x.dup_in_file).length;
    const exists = res.records.filter((x) => x.already_in_table).length;
    $("#adifSummary").innerHTML =
      "共解析 <b>" + res.total + "</b> 条；文件内重复 " + dups + " 条；已在表中 " + exists + " 条。" +
      "默认只勾选不重复、且不在表中的记录。";
    const tb = $("#adifTable");
    tb.style.display = "";
    tb.querySelector("tbody").innerHTML = res.records.map((x, i) => {
      const badges = [];
      if (x.dup_in_file) badges.push('<span class="badge warn">文件内重复</span>');
      if (x.already_in_table) badges.push('<span class="badge grey">已在表中</span>');
      if (!x.has_address) badges.push('<span class="badge">无地址</span>');
      const checked = !x.dup_in_file && !x.already_in_table;
      return "<tr><td><input type=\"checkbox\" data-i=\"" + i + "\"" + (checked ? " checked" : "") + "></td>" +
        "<td><b>" + esc(x.callsign) + "</b> " + qrzBtn(x.callsign) + "</td>" +
        "<td>" + esc(x.date) + "</td><td>" + esc(x.time) + "</td><td>" + esc(x.freq) + "</td>" +
        "<td>" + esc(x.mode) + "</td><td>" + esc(x.rst) + "</td>" +
        "<td>" + esc([x.name, x.comment].filter(Boolean).join(" ")) + "</td>" +
        "<td>" + badges.join(" ") + "</td></tr>";
    }).join("");
    $("#adifActions").style.display = "";
  } catch (err) { toast(err.message); }
});
$("#adifSelAll").addEventListener("click", () =>
  document.querySelectorAll("#adifTable tbody input[type=checkbox]").forEach((c) => { c.checked = true; }));
$("#adifSelNone").addEventListener("click", () =>
  document.querySelectorAll("#adifTable tbody input[type=checkbox]").forEach((c) => { c.checked = false; }));
$("#adifImportBtn").addEventListener("click", async () => {
  const idx = [...document.querySelectorAll("#adifTable tbody input[type=checkbox]:checked")]
    .map((c) => +c.dataset.i);
  if (!idx.length) { toast("请先勾选要导入的记录"); return; }
  const recs = idx.map((i) => adifRecords[i]);
  try {
    const res = await api("/api/adif/import", "POST", { records: recs });
    toast("已导入 " + res.added + " 条，跳过 " + res.skipped + " 条");
    await loadData();
  } catch (err) { toast("导入失败：" + err.message); }
});

loadData().catch((e) => { $("#statLine").textContent = "加载失败：" + e.message; });
