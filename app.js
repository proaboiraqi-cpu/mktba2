(function () {
  var docs = [], sources = [], layout = null, reviewIds = {}, pageIdx = 0, counter = 0, paper = [210, 297];
  var $ = function (id) { return document.getElementById(id); };
  var NAMES = {}; AK.KINDS.forEach(function (k) { NAMES[k.id] = k.label; });

  function setBusy(msg, pct) {
    var b = $("busy"); if (!msg) { b.hidden = true; return; }
    b.hidden = false; $("busyText").textContent = msg; $("busyBar").style.width = (pct || 0) + "%";
  }
  function showError(msg) { var e = $("err"); e.textContent = msg || ""; e.hidden = !msg; }
  function byId(id) { for (var i = 0; i < docs.length; i++) if (docs[i].id === id) return docs[i]; return null; }
  function canvasUrl(c) { return new Promise(function (res) { c.toBlob(function (b) { res(URL.createObjectURL(b)); }, "image/jpeg", 0.92); }); }
  function invalidate() { layout = null; $("preview").hidden = true; }
  function tick() { return new Promise(function (r) { setTimeout(r, 20); }); }

  function engineText(s) {
    if (s === "ready") return "أداة القص: جاهزة ✓";
    if (s === "loading") return "أداة القص: جاري التحميل (أول مرة تاخذ ثواني)...";
    if (s === "idle") return "أداة القص: تنتظر أول صورة";
    return "أداة القص: فشلت (" + s + ") — سيتم إضافة الصور كاملة";
  }

  async function addDoc(canvas, sourceId, whole) {
    var d = { id: "d" + (++counter), sourceId: sourceId, canvas: canvas, url: await canvasUrl(canvas), kind: "other", sure: false, name: "", sameAsPrev: false, note: "" };
    docs.push(d); return d;
  }

  async function addFiles(files) {
    showError("");
    var list = Array.prototype.filter.call(files, function (f) { return f.type.indexOf("image/") === 0; });
    if (!list.length) { showError("ما لقيت صور مدعومة، اختار ملفات JPG أو PNG"); return; }
    var fresh = [];
    for (var i = 0; i < list.length; i++) {
      setBusy("جاري كشف المستمسكات في الصورة " + (i + 1) + " من " + list.length, Math.round(i / list.length * 50));
      await tick();
      try {
        var r = await IMG.detectFile(list[i]);
        var sid = "s" + (++counter);
        sources.push({ id: sid, name: list[i].name, canvas: r.source, url: await canvasUrl(r.source), count: r.docs.length, note: r.note });
        for (var j = 0; j < r.docs.length; j++) { var d = await addDoc(r.docs[j].canvas, sid); d.note = r.note || (r.docs.length > 1 ? "مفصول من صورة فيها " + r.docs.length + " مستمسكات" : "تم القص"); fresh.push(d); }
      } catch (e) { showError("تعذر فتح الملف: " + list[i].name); }
    }
    if ($("autoType").checked) {
      for (var k = 0; k < fresh.length; k++) {
        setBusy("جاري التعرف على نوع المستمسك " + (k + 1) + " من " + fresh.length + " (أول مرة أبطأ)", 50 + Math.round(k / fresh.length * 50));
        await tick();
        try {
          var c = await IMG.classify(fresh[k].canvas);
          fresh[k].kind = c.type; fresh[k].sure = c.sure;
          if (c.flipped) { /* text read upside down: show the document upright */ fresh[k].canvas = IMG.rotateCW(IMG.rotateCW(fresh[k].canvas)); fresh[k].url = await canvasUrl(fresh[k].canvas); }
        } catch (e) { fresh[k].note += " | تعذر التعرف على النوع"; }
      }
    }
    setBusy(""); invalidate(); render();
  }

  function move(id, dir) { var i = docs.findIndex(function (d) { return d.id === id; }), j = i + dir; if (i < 0 || j < 0 || j >= docs.length) return; var t = docs[i]; docs[i] = docs[j]; docs[j] = t; invalidate(); render(); }
  function remove(id) { docs = docs.filter(function (d) { return d.id !== id; }); invalidate(); render(); }
  async function rotate(id) { var d = byId(id); if (!d) return; d.canvas = IMG.rotateCW(d.canvas); d.url = await canvasUrl(d.canvas); invalidate(); render(); }
  async function readName(id) {
    var d = byId(id); if (!d) return; setBusy("جاري قراءة النص...", 50);
    try { var s = IMG.suggestName(await IMG.readText(d.canvas)); if (s) { d.name = s; invalidate(); render(); } else showError("ما قدرت أقرا اسم واضح، اكتبه يدوياً"); }
    catch (e) { showError("تعذر قراءة الاسم، اكتبه يدوياً"); }
    setBusy("");
  }
  async function addWhole(sid) {
    var s = sources.find(function (x) { return x.id === sid; }); if (!s) return;
    var c = document.createElement("canvas"); c.width = s.canvas.width; c.height = s.canvas.height; c.getContext("2d").drawImage(s.canvas, 0, 0);
    var d = await addDoc(c, sid); d.note = "الصورة كاملة (أضفتها يدوياً)"; s.count++; invalidate(); render();
  }

  // person grouping: back sides follow their front, "same as previous" ticks, then names, else its own person
  function buildGroups() {
    var groups = [], groupOf = {}, review = {}, prev = null, prevGroup = null, solo = 0;
    docs.forEach(function (d) {
      var g = null;
      if (prev && d.sameAsPrev) g = prevGroup;
      else if (prev && AK.isBack(d.kind) && prev.kind === AK.frontOf(d.kind)) g = prevGroup;
      else if (d.name.trim()) { var r = AK.assignGroup(d.name, groups); g = "g" + r.groupId; if (r.review) review[d.id] = true; }
      else { g = "solo" + (++solo); review[d.id] = true; }
      groupOf[d.id] = g; prev = d; prevGroup = g;
    });
    return { groupOf: groupOf, review: review };
  }

  function arrange() {
    showError(""); if (!docs.length) return;
    var p = AK.PAPERS[$("paper").value]; paper = p;
    var gg = buildGroups(), rank = {}, n = 0;
    docs.forEach(function (d) { if (rank[gg.groupOf[d.id]] === undefined) rank[gg.groupOf[d.id]] = n++; });
    var sorted = docs.map(function (d, i) { return { d: d, i: i }; }).sort(function (a, b) {
      return (rank[gg.groupOf[a.d.id]] - rank[gg.groupOf[b.d.id]]) || (AK.KIND_ORDER.indexOf(a.d.kind) - AK.KIND_ORDER.indexOf(b.d.kind)) || (a.i - b.i);
    }).map(function (x) { return x.d; });
    var items = sorted.map(function (d) { var b = AK.baseSize(d.kind, d.canvas.width, d.canvas.height); return { id: d.id, group: gg.groupOf[d.id], baseW: b[0], baseH: b[1], allowRotate: true }; });
    var margin = $("paper").value === "A5" ? 8 : 10;
    layout = AK.paginate(items, { pageW: p[0], pageH: p[1], margin: margin, pagePerGroup: $("pagePerPerson").checked });
    reviewIds = gg.review; pageIdx = 0;
    render(); renderPreview(); $("preview").hidden = false; $("preview").scrollIntoView({ behavior: "smooth" });
  }

  function lowDpi(d, it) { return Math.max(d.canvas.width, d.canvas.height) / (Math.max(it.w, it.h) / 25.4) < 150; }

  function renderPreview() {
    var box = $("sheet"); box.innerHTML = ""; box.style.aspectRatio = paper[0] + " / " + paper[1];
    var page = layout.pages[pageIdx]; if (!page) return;
    page.items.forEach(function (it) {
      var d = byId(it.docId), el = document.createElement("div");
      el.className = "item" + (lowDpi(d, it) ? " lowdpi" : "");
      el.style.left = (it.x / paper[0] * 100) + "%"; el.style.top = (it.y / paper[1] * 100) + "%";
      el.style.width = (it.w / paper[0] * 100) + "%"; el.style.height = (it.h / paper[1] * 100) + "%";
      var img = document.createElement("img"); img.src = d.url; img.style.position = "absolute"; img.style.objectFit = "fill";
      if (it.rotated) {
        img.style.width = (it.h / it.w * 100) + "%"; img.style.height = (it.w / it.h * 100) + "%";
        img.style.left = ((1 - it.h / it.w) / 2 * 100) + "%"; img.style.top = ((1 - it.w / it.h) / 2 * 100) + "%"; img.style.transform = "rotate(90deg)";
      } else { img.style.left = "0"; img.style.top = "0"; img.style.width = "100%"; img.style.height = "100%"; }
      el.appendChild(img); el.onclick = function () { zoom(d.url); }; box.appendChild(el);
    });
    $("pageInfo").textContent = "صفحة " + (pageIdx + 1) + " من " + layout.pages.length;
    $("prev").disabled = pageIdx === 0; $("next").disabled = pageIdx >= layout.pages.length - 1;
    var msg = layout.unplaced.length ? "بعض الصور ما انتظمت (" + layout.unplaced.length + ")، احذف بعضها أو غيّر حجم الورقة" : "";
    $("layoutErr").textContent = msg; $("layoutErr").hidden = !msg;
  }
  function zoom(url) { $("zoomImg").src = url; $("zoom").hidden = false; }

  async function downloadPdf() {
    if (!layout) return; setBusy("جاري إنشاء PDF", 50);
    try {
      var bytes = await IMG.buildPdf(layout.pages, function (id, rotated) { var d = byId(id); return rotated ? IMG.rotateCW(d.canvas) : d.canvas; }, paper[0], paper[1]);
      var url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), a = document.createElement("a");
      a.href = url; a.download = "AK-Software.pdf"; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { showError("تعذر إنشاء PDF، جرّب مرة ثانية"); }
    setBusy("");
  }

  function btn(label, fn, disabled, cls) { var b = document.createElement("button"); b.textContent = label; b.onclick = fn; b.disabled = !!disabled; if (cls) b.className = cls; return b; }

  function render() {
    var list = $("docs"); list.innerHTML = "";
    $("docsSection").hidden = !docs.length; $("arrangeBtn").hidden = !docs.length;
    $("count").textContent = docs.length ? "عدد المستمسكات: " + docs.length + " (من " + sources.length + " صورة)" : "ما في صور بعد";
    docs.forEach(function (d, i) {
      var card = document.createElement("div"); card.className = "doc";
      var img = document.createElement("img"); img.src = d.url; img.onclick = function () { zoom(d.url); };
      var f = document.createElement("div"); f.className = "fields";
      var kind = document.createElement("select");
      AK.KINDS.forEach(function (k) { var o = document.createElement("option"); o.value = k.id; o.textContent = k.label; if (k.id === d.kind) o.selected = true; kind.appendChild(o); });
      kind.onchange = function () { d.kind = kind.value; d.sure = true; invalidate(); render(); };
      var name = document.createElement("input"); name.type = "text"; name.placeholder = "اسم صاحب المستمسك (اختياري)"; name.value = d.name; name.oninput = function () { d.name = name.value; invalidate(); };
      var same = document.createElement("label"); var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = d.sameAsPrev; cb.disabled = i === 0;
      cb.onchange = function () { d.sameAsPrev = cb.checked; invalidate(); }; same.appendChild(cb); same.appendChild(document.createTextNode(" نفس الشخص اللي قبله"));
      var note = document.createElement("small"); note.className = d.sure ? "ok" : "warn";
      note.textContent = (d.sure ? "✓ نوع مؤكد. " : "⚠ النوع تخمين، تأكد منه. ") + d.note;
      f.appendChild(kind); f.appendChild(name); f.appendChild(same); f.appendChild(note);
      if (layout && reviewIds[d.id]) { var w = document.createElement("small"); w.className = "warn"; w.textContent = "ما انربط بشخص محدد (بدون اسم)"; f.appendChild(w); }
      var row = document.createElement("div"); row.className = "row";
      row.appendChild(btn("↑", function () { move(d.id, -1); }, i === 0)); row.appendChild(btn("↓", function () { move(d.id, 1); }, i === docs.length - 1));
      row.appendChild(btn("تدوير 90°", function () { rotate(d.id); })); row.appendChild(btn("اقرأ الاسم", function () { readName(d.id); }));
      row.appendChild(btn("حذف", function () { remove(d.id); }, false, "danger")); f.appendChild(row);
      card.appendChild(img); card.appendChild(f); list.appendChild(card);
    });
    var sl = $("sources"); sl.innerHTML = ""; $("srcSection").hidden = !sources.length;
    sources.forEach(function (s) {
      var row = document.createElement("div"); row.className = "src";
      var im = document.createElement("img"); im.src = s.url; im.onclick = function () { zoom(s.url); };
      var t = document.createElement("span"); t.textContent = s.name + " — كُشف " + s.count + " مستمسك";
      row.appendChild(im); row.appendChild(t); row.appendChild(btn("أضف الصورة كاملة", function () { addWhole(s.id); })); sl.appendChild(row);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var input = $("file");
    $("drop").onclick = function () { input.click(); };
    $("drop").ondragover = function (e) { e.preventDefault(); };
    $("drop").ondrop = function (e) { e.preventDefault(); addFiles(e.dataTransfer.files); };
    input.onchange = function () { addFiles(input.files); input.value = ""; };
    $("arrangeBtn").onclick = arrange; $("pdfBtn").onclick = downloadPdf;
    $("prev").onclick = function () { pageIdx = Math.max(0, pageIdx - 1); renderPreview(); };
    $("next").onclick = function () { pageIdx = Math.min(layout.pages.length - 1, pageIdx + 1); renderPreview(); };
    $("zoom").onclick = function () { $("zoom").hidden = true; };
    IMG.startDetector(function (s) { $("engine").textContent = engineText(s); });
    $("engine").textContent = engineText(IMG.getStatus());
    render();
  });
  window.AKApp = { _docs: function () { return docs; }, _set: function (d) { docs = d; }, buildGroups: buildGroups };
})();
