// Document detection with plain geometry (OpenCV.js). No AI model, no training.
// Works in a Web Worker (self.cv) and in Node (for tests). img = {data: RGBA Uint8ClampedArray, width, height}
function createDetector(cv) {
  var K = {};
  function kernel(n) { return cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(n, n)); }
  function toMat(img) { var m = new cv.Mat(img.height, img.width, cv.CV_8UC4); m.data.set(img.data); return m; }
  function fromMat(m) { return { data: new Uint8ClampedArray(m.data), width: m.cols, height: m.rows }; }
  function resizeImg(img, s) {
    var m = toMat(img), d = new cv.Mat();
    cv.resize(m, d, new cv.Size(Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s))), 0, 0, cv.INTER_AREA);
    var o = fromMat(d); m.delete(); d.delete(); return o;
  }
  function cropImg(img, x, y, w, h) {
    var out = new Uint8ClampedArray(w * h * 4);
    for (var r = 0; r < h; r++) {
      var so = ((y + r) * img.width + x) * 4;
      out.set(img.data.subarray(so, so + w * 4), r * w * 4);
    }
    return { data: out, width: w, height: h };
  }
  function median(a) { a.sort(function (p, q) { return p - q; }); return a[a.length >> 1]; }
  function borderBg(img) {
    var W = img.width, H = img.height, d = img.data, r = [], g = [], b = [];
    function push(x, y) { var i = (y * W + x) * 4; r.push(d[i]); g.push(d[i + 1]); b.push(d[i + 2]); }
    var x, y;
    for (x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    return [median(r), median(g), median(b)];
  }

  // ---- candidate masks ----
  function masks(img) {
    var out = [], W = img.width, H = img.height, n = W * H;
    var src = toMat(img), gray = new cv.Mat(), blur = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    var k5 = kernel(5), k7 = kernel(7), k9 = kernel(9);
    [[30, 90], [60, 160]].forEach(function (p) {
      var e = new cv.Mat(), c = new cv.Mat();
      cv.Canny(blur, e, p[0], p[1]);
      cv.morphologyEx(e, c, cv.MORPH_CLOSE, k7);
      e.delete(); out.push({ name: 'canny' + p[0], mat: c });
    });
    var bg = borderBg(img), d = img.data, dist = new Uint16Array(n), i, q;
    for (i = 0, q = 0; i < n; i++, q += 4) dist[i] = Math.abs(d[q] - bg[0]) + Math.abs(d[q + 1] - bg[1]) + Math.abs(d[q + 2] - bg[2]);
    [25, 40, 70, 110].forEach(function (t) {
      var m = new cv.Mat(H, W, cv.CV_8UC1), md = m.data;
      for (var j = 0; j < n; j++) md[j] = dist[j] > t ? 255 : 0;
      var c = new cv.Mat(), o = new cv.Mat();
      cv.morphologyEx(m, c, cv.MORPH_CLOSE, k9); cv.morphologyEx(c, o, cv.MORPH_OPEN, k5);
      m.delete(); c.delete(); out.push({ name: 'bg' + t, mat: o });
    });
    var ot = new cv.Mat();
    cv.threshold(blur, ot, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    [['otsu+', false], ['otsu-', true]].forEach(function (v) {
      var m = v[1] ? new cv.Mat() : ot.clone();
      if (v[1]) cv.bitwise_not(ot, m);
      var c = new cv.Mat(), o = new cv.Mat();
      cv.morphologyEx(m, c, cv.MORPH_CLOSE, k9); cv.morphologyEx(c, o, cv.MORPH_OPEN, k5);
      m.delete(); c.delete(); out.push({ name: v[0], mat: o });
    });
    ot.delete(); src.delete(); gray.delete(); blur.delete(); k5.delete(); k7.delete(); k9.delete();
    return out;
  }

  function candidates(img, minArea) {
    var A = img.width * img.height, cands = [], ms = masks(img);
    ms.forEach(function (mk) {
      var cs = new cv.MatVector(), h = new cv.Mat();
      cv.findContours(mk.mat, cs, h, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (var i = 0; i < cs.size(); i++) {
        var c = cs.get(i), a = cv.contourArea(c);
        if (a >= minArea * A) {
          var r = cv.minAreaRect(c), rw = r.size.width, rh = r.size.height, ra = rw * rh;
          if (ra > 0) {
            var rect = a / ra, ar = Math.max(rw, rh) / Math.max(1e-6, Math.min(rw, rh));
            if (!(rect < 0.86 || ar > 4.8 || ar < 1.2) && !(ra > 0.985 * A && mk.name.indexOf('canny') === 0)) {
              cands.push({ src: mk.name, box: cv.RotatedRect.points(r).map(function (p) { return [p.x, p.y]; }), area: ra, rect: rect, ar: ar });
            }
          }
        }
        c.delete();
      }
      cs.delete(); h.delete(); mk.mat.delete();
    });
    return cands;
  }

  function bb(c) {
    var xs = c.box.map(function (p) { return p[0]; }), ys = c.box.map(function (p) { return p[1]; });
    return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
  }
  function iouAxis(a, b) {
    var A = bb(a), B = bb(b);
    var ix = Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0])), iy = Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1]));
    var inter = ix * iy, ua = (A[2] - A[0]) * (A[3] - A[1]) + (B[2] - B[0]) * (B[3] - B[1]) - inter;
    return ua > 0 ? inter / ua : 0;
  }
  function contains(a, b, frac) {
    frac = frac || 0.85;
    var A = bb(a), B = bb(b);
    var ix = Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0])), iy = Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1]));
    return ix * iy >= frac * (B[2] - B[0]) * (B[3] - B[1]);
  }

  function dedupe(cands) {
    cands = cands.slice().sort(function (a, b) { return b.rect - a.rect; });
    var clusters = [];
    cands.forEach(function (c) {
      for (var i = 0; i < clusters.length; i++) if (iouAxis(clusters[i][0], c) > 0.7) { clusters[i].push(c); return; }
      clusters.push([c]);
    });
    return clusters.map(function (cl) {
      var srcs = {}; cl.forEach(function (x) { srcs[x.src] = 1; });
      var best = cl.reduce(function (p, x) { return (x.rect > p.rect || (x.rect === p.rect && x.area < p.area)) ? x : p; });
      return { src: best.src, box: best.box, area: best.area, rect: best.rect, ar: best.ar, votes: Object.keys(srcs).length };
    });
  }
  function unionBox(a, b) {
    var pts = a.box.concat(b.box), flat = [];
    pts.forEach(function (p) { flat.push(p[0], p[1]); });
    var m = cv.matFromArray(pts.length, 1, cv.CV_32FC2, flat), r = cv.minAreaRect(m); m.delete();
    return { src: 'merge', box: cv.RotatedRect.points(r).map(function (p) { return [p.x, p.y]; }), area: r.size.width * r.size.height, rect: 1, ar: Math.max(r.size.width, r.size.height) / Math.max(1e-6, Math.min(r.size.width, r.size.height)), votes: Math.min(a.votes, b.votes) };
  }
  function mergePieces(kept) {
    var changed = true;
    while (changed) {
      changed = false;
      outer: for (var i = 0; i < kept.length; i++) for (var j = i + 1; j < kept.length; j++) {
        var a = kept[i], b = kept[j], A = bb(a), B = bb(b);
        var ox = Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0])) / Math.max(1e-6, Math.min(A[2] - A[0], B[2] - B[0]));
        var oy = Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1])) / Math.max(1e-6, Math.min(A[3] - A[1], B[3] - B[1]));
        var gapy = Math.max(A[1], B[1]) - Math.min(A[3], B[3]), gapx = Math.max(A[0], B[0]) - Math.min(A[2], B[2]);
        var stacked = ox > 0.85 && gapy < 0.06 * Math.max(A[3], B[3]), side = oy > 0.85 && gapx < 0.06 * Math.max(A[2], B[2]);
        if (!(stacked || side)) continue;
        var u = unionBox(a, b), strip = Math.max(a.ar, b.ar) > 2.4;
        if (strip && u.ar >= 1.25 && u.ar <= 2.0) {
          kept = kept.filter(function (_, n) { return n !== i && n !== j; }); kept.push(u); changed = true; break outer;
        }
      }
    }
    return kept;
  }
  function dropContainers(kept) {
    var final = kept.filter(function (a) {
      var inside = kept.filter(function (b) { return b !== a && b.area < a.area * 0.9 && contains(a, b); });
      return inside.length < 2;
    });
    return final.filter(function (a) {
      var big = final.filter(function (b) { return b !== a && b.area > a.area && contains(b, a); });
      return !(big.length && a.votes < 2);
    });
  }

  function blank(img, boxes) {
    var m = toMat(img), bg = borderBg(img), mv = new cv.MatVector();
    boxes.forEach(function (c) {
      var cx = 0, cy = 0; c.box.forEach(function (p) { cx += p[0] / 4; cy += p[1] / 4; });
      var flat = []; c.box.forEach(function (p) { flat.push(Math.round(cx + (p[0] - cx) * 1.04), Math.round(cy + (p[1] - cy) * 1.04)); });
      mv.push_back(cv.matFromArray(4, 1, cv.CV_32SC2, flat));
    });
    cv.fillPoly(m, mv, new cv.Scalar(bg[0], bg[1], bg[2], 255));
    var o = fromMat(m); m.delete(); mv.delete(); return o;
  }
  function borderUniform(img) {
    var W = img.width, H = img.height, t = Math.max(3, Math.floor(0.03 * Math.min(H, W))), d = img.data;
    var strips = [[0, W, 0, t], [0, W, H - t, H], [0, t, 0, H], [W - t, W, 0, H]], means = [], maxStd = 0;
    strips.forEach(function (s) {
      var sum = [0, 0, 0], sq = [0, 0, 0], n = 0;
      for (var y = s[2]; y < s[3]; y++) for (var x = s[0]; x < s[1]; x++) {
        var i = (y * W + x) * 4; for (var c = 0; c < 3; c++) { sum[c] += d[i + c]; sq[c] += d[i + c] * d[i + c]; } n++;
      }
      var mean = sum.map(function (v) { return v / n; });
      var std = sq.map(function (v, c) { return Math.sqrt(Math.max(0, v / n - mean[c] * mean[c])); });
      means.push(mean); maxStd = Math.max(maxStd, (std[0] + std[1] + std[2]) / 3);
    });
    var ptp = 0; for (var c = 0; c < 3; c++) { var v = means.map(function (m) { return m[c]; }); ptp = Math.max(ptp, Math.max.apply(null, v) - Math.min.apply(null, v)); }
    return maxStd < 28 && ptp < 35;
  }

  // Stacked documents on one white page, separated by a blank horizontal band.
  function xySplit(img) {
    var W = img.width, H = img.height, d = img.data, n = W * H, ch = [[], [], []], i, c;
    for (i = 0; i < n; i += 7) { ch[0].push(d[i * 4]); ch[1].push(d[i * 4 + 1]); ch[2].push(d[i * 4 + 2]); }
    var bg = ch.map(median), ink = new Uint8Array(n);
    for (i = 0; i < n; i++) ink[i] = (Math.abs(d[i * 4] - bg[0]) + Math.abs(d[i * 4 + 1] - bg[1]) + Math.abs(d[i * 4 + 2] - bg[2])) > 60 ? 1 : 0;
    var row = new Float32Array(H);
    for (var y = 0; y < H; y++) { var s = 0; for (var x = 0; x < W; x++) s += ink[y * W + x]; row[y] = s / W; }
    var runs = [], st = -1;
    for (y = 0; y < H; y++) { var bl = row[y] < 0.003; if (bl && st < 0) st = y; if (!bl && st >= 0) { runs.push([st, y]); st = -1; } }
    if (st >= 0) runs.push([st, H]);
    var cuts = runs.filter(function (r) { return (r[1] - r[0]) >= 0.012 * H && r[0] > 0.15 * H && r[1] < 0.85 * H; }).map(function (r) { return (r[0] + r[1]) >> 1; });
    if (!cuts.length) return null;
    var bounds = [0].concat(cuts, [H]), pieces = [];
    for (var k = 0; k < bounds.length - 1; k++) {
      var y0 = bounds[k], y1 = bounds[k + 1], ys0 = -1, ys1 = -1, xs0 = W, xs1 = -1;
      var colSum = new Float32Array(W);
      for (y = y0; y < y1; y++) { var rs = 0; for (x = 0; x < W; x++) { var v = ink[y * W + x]; rs += v; colSum[x] += v; } if (rs / W >= 0.003) { if (ys0 < 0) ys0 = y; ys1 = y; } }
      for (x = 0; x < W; x++) if (colSum[x] / (y1 - y0) >= 0.003) { if (x < xs0) xs0 = x; if (x > xs1) xs1 = x; }
      if (ys0 < 0 || xs1 < 0) return null;
      var pad = Math.round(0.012 * Math.max(H, W)), top = Math.max(0, ys0 - pad), bot = Math.min(H, ys1 + pad), l = Math.max(0, xs0 - pad), r = Math.min(W, xs1 + pad);
      var w = r - l, h = bot - top, ar = Math.max(w, h) / Math.max(1, Math.min(w, h));
      if (h < 0.2 * H || ar < 1.2 || ar > 3.4) return null;
      pieces.push({ src: 'xycut', box: [[l, top], [r, top], [r, bot], [l, bot]], area: w * h, rect: 1, ar: ar, votes: 1 });
    }
    return pieces.length >= 2 ? pieces : null;
  }

  function paperCrop(img) {
    var A = img.width * img.height, src = toMat(img), g = new cv.Mat(), b = new cv.Mat(), o = new cv.Mat(), op = new cv.Mat(), k9 = kernel(9);
    cv.cvtColor(src, g, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(g, b, new cv.Size(5, 5), 0);
    cv.threshold(b, o, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); cv.morphologyEx(o, op, cv.MORPH_OPEN, k9);
    var cs = new cv.MatVector(), h = new cv.Mat(); cv.findContours(op, cs, h, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    var best = null;
    for (var i = 0; i < cs.size(); i++) { var c = cs.get(i), a = cv.contourArea(c); if (a > 0.2 * A && a < 0.9 * A && (!best || a > best[0])) best = [a, cv.boundingRect(c)]; c.delete(); }
    cs.delete(); h.delete(); src.delete(); g.delete(); b.delete(); o.delete(); op.delete(); k9.delete();
    return best ? best[1] : null;
  }

  function mainPass(img) {
    var W = img.width, H = img.height, A = W * H, found = [], work = img;
    for (var rnd = 0; rnd < 4; rnd++) {
      var kept = dropContainers(mergePieces(dedupe(candidates(work, rnd < 2 ? 0.02 : 0.012))));
      kept = kept.filter(function (k) { return k.area < 0.9 * A; });
      var nw = kept.filter(function (k) { return !found.some(function (f) { return iouAxis(k, f) > 0.4; }); });
      if (!nw.length) break;
      found = found.concat(nw); work = blank(img, found);
    }
    var total = found.reduce(function (s, f) { return s + f.area; }, 0);
    if (!found.length || (total < 0.12 * A && borderUniform(img))) {
      var sp = xySplit(img);
      if (sp) found = sp;
      else if (!found.length || total < 0.12 * A)
        found = [{ src: 'whole', box: [[0, 0], [W, 0], [W, H], [0, H]], area: A, rect: 1, ar: Math.max(W, H) / Math.min(W, H), votes: 1 }];
    }
    return found;
  }

  function innerPass(img, found) {
    var r = paperCrop(img); if (!r) return found;
    var sub = cropImg(img, r.x, r.y, r.width, r.height), s = 800 / Math.max(r.width, r.height), big = resizeImg(sub, s);
    var Ab = big.width * big.height, inner = [], work = big;
    for (var rnd = 0; rnd < 3; rnd++) {
      var kept = dropContainers(mergePieces(dedupe(candidates(work, 0.03)))).filter(function (k) { return k.area >= 0.03 * Ab && k.area < 0.6 * Ab; });
      var nw = kept.filter(function (k) { return !inner.some(function (f) { return iouAxis(k, f) > 0.4; }); });
      if (!nw.length) break;
      inner = inner.concat(nw); work = blank(big, inner);
    }
    var out = found.slice();
    inner.forEach(function (k) {
      var m = { src: k.src, box: k.box.map(function (p) { return [p[0] / s + r.x, p[1] / s + r.y]; }), area: k.area / (s * s), rect: k.rect, ar: k.ar, votes: k.votes };
      if (!out.some(function (f) { return iouAxis(m, f) > 0.4; })) out.push(m);
    });
    return out;
  }

  // Returns boxes in the coordinates of `img` (already downscaled for speed).
  function detect(img) {
    var H = img.height, A = img.width * H, found = mainPass(img), total = found.reduce(function (s, f) { return s + f.area; }, 0);
    var isWhole = found.some(function (f) { return f.src === 'whole'; });
    if (isWhole && !borderUniform(img)) { var inn = innerPass(img, []); if (inn.length >= 2) found = inn; }
    else if (total < 0.25 * A && !found.some(function (f) { return f.src === 'xycut'; })) found = innerPass(img, found);
    return found.sort(function (a, b) {
      var ay = a.box.reduce(function (s, p) { return s + p[1]; }, 0) / 4, by = b.box.reduce(function (s, p) { return s + p[1]; }, 0) / 4;
      var ra = Math.round(ay / (0.12 * H)), rb = Math.round(by / (0.12 * H));
      if (ra !== rb) return ra - rb;
      return a.box.reduce(function (s, p) { return s + p[0]; }, 0) - b.box.reduce(function (s, p) { return s + p[0]; }, 0);
    });
  }

  // Straighten one box from the full-resolution image. scale = small/full.
  function warp(fullImg, box, scale) {
    var b = box.map(function (p) { return [p[0] / scale, p[1] / scale]; });
    var sum = function (p) { return p[0] + p[1]; }, dif = function (p) { return p[1] - p[0]; };
    function pick(fn, sign) { return b.reduce(function (a, c) { return sign * fn(c) < sign * fn(a) ? c : a; }); }
    var tl = pick(sum, 1), br = pick(sum, -1), tr = pick(dif, 1), bl = pick(dif, -1);
    var dist = function (p, q) { return Math.hypot(p[0] - q[0], p[1] - q[1]); };
    var w = Math.max(2, Math.round(Math.max(dist(tl, tr), dist(bl, br)))), h = Math.max(2, Math.round(Math.max(dist(tl, bl), dist(tr, br))));
    var src = toMat(fullImg), dst = new cv.Mat();
    var sp = cv.matFromArray(4, 1, cv.CV_32FC2, [tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1]]);
    var dp = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    var M = cv.getPerspectiveTransform(sp, dp);
    cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
    var o = fromMat(dst); src.delete(); dst.delete(); sp.delete(); dp.delete(); M.delete(); return o;
  }

  // Full pipeline: full-resolution RGBA in, list of straightened documents out.
  function run(fullImg) {
    var s = Math.min(1, 800 / Math.max(fullImg.width, fullImg.height));
    var small = s < 1 ? resizeImg(fullImg, s) : fullImg;
    var boxes = detect(small);
    return boxes.map(function (c) { return { src: c.src, ar: c.ar, img: warp(fullImg, c.box, s) }; });
  }
  return { run: run, detect: detect, resizeImg: resizeImg };
}
if (typeof module !== 'undefined') module.exports = createDetector;
