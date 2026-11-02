// Browser side: detection worker client, OCR type recognition (offline), PDF export.
var IMG = (function () {
  var worker = null, pending = {}, rid = 0, status = "idle", onStatus = null, ocrWorker = null;

  function setStatus(s) { status = s; if (onStatus) onStatus(s); }
  function failAll(err) { Object.keys(pending).forEach(function (k) { clearTimeout(pending[k].timer); pending[k].reject(err); delete pending[k]; }); }

  function startDetector(cb) {
    if (cb) onStatus = cb;
    if (worker) return;
    try {
      worker = new Worker("./worker.js");
    } catch (e) { setStatus("failed: " + e.message); return; }
    worker.onmessage = function (e) {
      var m = e.data;
      if (m.type === "status") return setStatus(m.text);
      var p = pending[m.id];
      if (!p) return;
      delete pending[m.id]; clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.docs);
    };
    worker.onerror = function (e) { setStatus("failed: " + (e.message || "worker error")); failAll(new Error("worker error")); };
    worker.postMessage({ type: "init" });
  }
  function getStatus() { return status; }

  function runDetect(canvas) {
    startDetector();
    return new Promise(function (resolve, reject) {
      var id = ++rid;
      var limit = status === "ready" ? 60000 : 180000; // first call also waits for OpenCV to load
      var timer = setTimeout(function () { delete pending[id]; reject(new Error("timeout")); }, limit);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      var data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      worker.postMessage({ id: id, buffer: data.data.buffer, width: canvas.width, height: canvas.height }, [data.data.buffer]);
    });
  }

  function fromBuffer(buf, w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
    return c;
  }
  function rotateCW(src) {
    var dst = document.createElement("canvas");
    dst.width = src.height; dst.height = src.width;
    var ctx = dst.getContext("2d");
    ctx.translate(dst.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(src, 0, 0);
    return dst;
  }
  function rotate180(src) {
    var dst = document.createElement("canvas");
    dst.width = src.width; dst.height = src.height;
    var ctx = dst.getContext("2d");
    ctx.translate(dst.width, dst.height); ctx.rotate(Math.PI); ctx.drawImage(src, 0, 0);
    return dst;
  }
  // Cards read landscape; long strips (ration paper) read portrait.
  function normalizeOrientation(c, ar) {
    if (ar <= 2.4 && c.height > c.width) return rotateCW(c);
    if (ar > 2.4 && c.width > c.height) return rotateCW(c);
    return c;
  }

  // One uploaded photo -> source canvas + list of separated documents.
  async function detectFile(file) {
    var bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    var cap = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    var src = document.createElement("canvas");
    src.width = Math.max(1, Math.round(bmp.width * cap)); src.height = Math.max(1, Math.round(bmp.height * cap));
    src.getContext("2d").drawImage(bmp, 0, 0, src.width, src.height);
    if (bmp.close) bmp.close();
    var docs, note = "";
    try {
      var res = await runDetect(src);
      docs = res.map(function (d) {
        return { canvas: normalizeOrientation(fromBuffer(d.buffer, d.width, d.height), d.ar), ar: d.ar, whole: d.src === "whole" };
      });
      if (!docs.length) throw new Error("no documents");
    } catch (e) {
      note = "تعذر الكشف التلقائي (" + e.message + ")، انضافت الصورة كاملة";
      docs = [{ canvas: src, ar: Math.max(src.width, src.height) / Math.min(src.width, src.height), whole: true }];
    }
    return { source: src, docs: docs, note: note };
  }

  // ---- OCR (Tesseract.js, Arabic + English, files bundled in lib/tesseract, works offline) ----
  async function getOcr() {
    if (ocrWorker) return ocrWorker;
    var base = new URL("./lib/tesseract/", location.href).href;
    ocrWorker = await Tesseract.createWorker(["ara", "eng"], 1, {
      workerPath: base + "worker.min.js", corePath: base, langPath: base, gzip: false, cacheMethod: "none"
    });
    await ocrWorker.setParameters({ tessedit_pageseg_mode: "6" });
    return ocrWorker;
  }
  function forOcr(c) {
    var long = Math.max(c.width, c.height), k = long < 1400 ? 1400 / long : 1;
    var o = document.createElement("canvas");
    o.width = Math.round(c.width * k); o.height = Math.round(c.height * k);
    var ctx = o.getContext("2d"); ctx.imageSmoothingQuality = "high";
    ctx.drawImage(c, 0, 0, o.width, o.height);
    return o;
  }
  async function classify(c) {
    var w = await getOcr();
    var ar = Math.max(c.width, c.height) / Math.min(c.width, c.height);
    var small = document.createElement("canvas");
    var k = Math.min(1, 300 / Math.max(c.width, c.height));
    small.width = Math.max(1, Math.round(c.width * k)); small.height = Math.max(1, Math.round(c.height * k));
    small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
    var halo = CLS.greenHalo(small.getContext("2d").getImageData(0, 0, small.width, small.height));
    var best = null, text = "";
    for (var rot = 0; rot < 2; rot++) {
      var src = forOcr(rot ? rotate180(c) : c);
      var r = await w.recognize(src);
      var dec = CLS.decide({ text: r.data.text, ar: ar, halo: halo });
      if (!best || (dec.sure && !best.sure)) { best = dec; text = r.data.text; best.flipped = !!rot; }
      if (best.sure) break;
    }
    best.text = text;
    return best;
  }
  function suggestName(text) {
    var lines = text.split("\n").map(function (l) { return l.replace(/[^\u0621-\u064A\s]/g, " ").replace(/\s+/g, " ").trim(); }).filter(Boolean);
    var c = lines.filter(function (l) { var w = l.split(" ").filter(function (x) { return x.length >= 2; }); return w.length >= 2 && w.length <= 4; });
    return c[0] || null;
  }
  async function readText(c) { var w = await getOcr(); return (await w.recognize(forOcr(c))).data.text; }

  function toJpegBytes(canvas) {
    return new Promise(function (res) { canvas.toBlob(function (b) { b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }); }, "image/jpeg", 0.95); });
  }
  async function buildPdf(pages, canvasOf, pageW, pageH) {
    var MM = 72 / 25.4, pdf = await PDFLib.PDFDocument.create(), cache = {};
    for (var p = 0; p < pages.length; p++) {
      var page = pdf.addPage([pageW * MM, pageH * MM]), items = pages[p].items;
      for (var k = 0; k < items.length; k++) {
        var it = items[k], key = it.docId + (it.rotated ? "r" : "");
        if (!cache[key]) cache[key] = await pdf.embedJpg(await toJpegBytes(canvasOf(it.docId, it.rotated)));
        page.drawImage(cache[key], { x: it.x * MM, y: (pageH - it.y - it.h) * MM, width: it.w * MM, height: it.h * MM });
      }
    }
    return pdf.save();
  }

  return { startDetector: startDetector, getStatus: getStatus, detectFile: detectFile, classify: classify, suggestName: suggestName, readText: readText, rotateCW: rotateCW, buildPdf: buildPdf };
})();
