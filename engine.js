// ===== Pure logic: packing, pagination, names, kinds (no DOM) =====
var AK = (function () {
  var A4 = { w: 210, h: 297 };
  var PAPERS = { A4: [210, 297], A5: [148, 210] };
  var KINDS = [
    { id: "national_id_front", label: "بطاقة وطنية - وجه", long: 85.6 },
    { id: "national_id_back", label: "بطاقة وطنية - ظهر", long: 85.6 },
    { id: "ration_card", label: "تموينية إلكترونية", long: 85.6 },
    { id: "housing_front", label: "بطاقة سكن - وجه", long: 85.6 },
    { id: "housing_back", label: "بطاقة سكن - ظهر", long: 85.6 },
    { id: "nationality", label: "شهادة الجنسية", long: 210 },
    { id: "passport", label: "جواز السفر", long: 125 },
    { id: "ration_paper", label: "تموينية ورقية (طويلة)", long: 210 },
    { id: "other", label: "غير مصنف", long: 85.6 }
  ];
  var KIND_ORDER = KINDS.map(function (k) { return k.id; });
  function kindById(id) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].id === id) return KINDS[i];
    return KINDS[KINDS.length - 1];
  }
  // Physical size: long side from the kind, short side from the image's own aspect (never distorts).
  function baseSize(kindId, w, h) {
    var long = kindById(kindId).long, ar = Math.max(w, h) / Math.max(1, Math.min(w, h)), short = long / ar;
    return w >= h ? [long, short] : [short, long];
  }
  function isBack(id) { return id === "national_id_back" || id === "housing_back"; }
  function frontOf(id) { return id === "national_id_back" ? "national_id_front" : id === "housing_back" ? "housing_front" : null; }

  // ---- MaxRects (Best Short Side Fit) ----
  function intersects(a, b) {
    return !(b.x >= a.x + a.w || b.x + b.w <= a.x || b.y >= a.y + a.h || b.y + b.h <= a.y);
  }
  function contains(a, b) {
    return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
  }
  function packAll(items, binW, binH, gap, sortFn) {
    var free = [{ x: 0, y: 0, w: binW, h: binH }];
    var out = [];
    var ordered = items.slice().sort(sortFn || function (a, b) { return b.w * b.h - a.w * a.h; });
    for (var k = 0; k < ordered.length; k++) {
      var it = ordered[k];
      var opts = [{ w: it.w + gap, h: it.h + gap, rotated: false }];
      if (it.allowRotate && it.w !== it.h) opts.push({ w: it.h + gap, h: it.w + gap, rotated: true });
      var best = null;
      for (var o = 0; o < opts.length; o++) {
        var opt = opts[o];
        for (var f = 0; f < free.length; f++) {
          var fr = free[f];
          if (opt.w <= fr.w && opt.h <= fr.h) {
            var lh = Math.abs(fr.w - opt.w), lv = Math.abs(fr.h - opt.h);
            var score = Math.min(lh, lv) * 1e6 + Math.max(lh, lv);
            if (!best || score < best.score) {
              best = { rect: { x: fr.x, y: fr.y, w: opt.w, h: opt.h }, score: score, rotated: opt.rotated };
            }
          }
        }
      }
      if (!best) return null;
      var p = best.rect;
      out.push({ id: it.id, x: p.x, y: p.y, w: p.w - gap, h: p.h - gap, rotated: best.rotated });
      var next = [];
      for (var q = 0; q < free.length; q++) {
        var r = free[q];
        if (!intersects(r, p)) { next.push(r); continue; }
        if (p.x > r.x) next.push({ x: r.x, y: r.y, w: p.x - r.x, h: r.h });
        if (p.x + p.w < r.x + r.w) next.push({ x: p.x + p.w, y: r.y, w: r.x + r.w - (p.x + p.w), h: r.h });
        if (p.y > r.y) next.push({ x: r.x, y: r.y, w: r.w, h: p.y - r.y });
        if (p.y + p.h < r.y + r.h) next.push({ x: r.x, y: p.y + p.h, w: r.w, h: r.y + r.h - (p.y + p.h) });
      }
      free = next.filter(function (a, i) {
        if (!(a.w > 0 && a.h > 0)) return false;
        for (var j = 0; j < next.length; j++) {
          if (j !== i && contains(next[j], a) && !(contains(a, next[j]) && j > i)) return false;
        }
        return true;
      });
    }
    return out;
  }

  var SORTERS = [
    function (a, b) { return b.w * b.h - a.w * a.h; },
    function (a, b) { return Math.max(b.w, b.h) - Math.max(a.w, a.h); },
    function (a, b) { return Math.min(b.w, b.h) - Math.min(a.w, a.h); },
    function (a, b) { return b.h - a.h; },
    function (a, b) { return b.w - a.w; }
  ];
  function orient(items, portrait) {
    return items.map(function (it) {
      var swap = portrait ? it.w > it.h : it.w < it.h;
      return swap ? { id: it.id, w: it.h, h: it.w, allowRotate: false } : { id: it.id, w: it.w, h: it.h, allowRotate: false };
    });
  }
  function packBest(items, binW, binH, gap) {
    var variants = [items, orient(items, true), orient(items, false)];
    for (var v = 0; v < variants.length; v++) {
      for (var s = 0; s < SORTERS.length; s++) {
        var p = packAll(variants[v], binW, binH, gap, SORTERS[s]);
        if (p) {
          var byId = {};
          items.forEach(function (it) { byId[it.id] = it; });
          return p.map(function (pl) {
            var orig = byId[pl.id];
            var rotated = orig.w === pl.w && orig.h === pl.h ? false : (orig.h === pl.w && orig.w === pl.h);
            return { id: pl.id, x: pl.x, y: pl.y, w: pl.w, h: pl.h, rotated: rotated && orig.w !== orig.h };
          });
        }
      }
    }
    return null;
  }

  // ---- Uniform scale per page, maximize size ----
  function fitScale(docs, o, floor) {
    floor = floor === undefined ? 0.05 : floor;
    var binW = o.pageW - 2 * o.margin, binH = o.pageH - 2 * o.margin;
    function tryAt(s) {
      return packBest(docs.map(function (d) {
        return { id: d.id, w: d.baseW * s, h: d.baseH * s, allowRotate: d.allowRotate };
      }), binW, binH, o.gap);
    }
    var lo = floor, hi = o.maxScale;
    var best = tryAt(lo);
    if (!best) return null;
    var bestScale = lo;
    for (var i = 0; i < 22; i++) {
      var mid = (lo + hi) / 2;
      var p = tryAt(mid);
      if (p) { lo = mid; best = p; bestScale = mid; } else hi = mid;
    }
    return { scale: bestScale, placements: best };
  }

  function paginate(docs, options) {
    options = options || {};
    var o = {
      pageW: options.pageW || A4.w, pageH: options.pageH || A4.h,
      margin: options.margin === undefined ? 10 : options.margin,
      gap: options.gap === undefined ? 4 : options.gap,
      minScale: options.minScale === undefined ? 0.75 : options.minScale,
      maxScale: options.maxScale === undefined ? 3.0 : options.maxScale,
      pagePerGroup: !!options.pagePerGroup
    };
    var groups = [], order = {};
    docs.forEach(function (d) {
      if (order[d.group] === undefined) { order[d.group] = groups.length; groups.push([]); }
      groups[order[d.group]].push(d);
    });

    var pages = [], unplaced = [];
    var current = [], currentFit = null;
    function flush() {
      if (current.length && currentFit) pages.push({ docs: current, fit: currentFit });
      current = []; currentFit = null;
    }
    function tryAdd(batch) {
      var cand = current.concat(batch);
      var fit = fitScale(cand, o);
      if (fit && fit.scale >= o.minScale) { current = cand; currentFit = fit; return true; }
      return false;
    }
    groups.forEach(function (group) {
      if (o.pagePerGroup) flush();
      if (tryAdd(group)) return;
      flush();
      if (tryAdd(group)) return;
      group.forEach(function (d) {
        if (tryAdd([d])) return;
        flush();
        if (tryAdd([d])) return;
        var fit = fitScale([d], o);
        if (fit) pages.push({ docs: [d], fit: fit });
        else unplaced.push(d.id);
      });
    });
    flush();

    return {
      pages: pages.map(function (p) {
        return {
          scale: p.fit.scale,
          items: p.fit.placements.map(function (pl) {
            return { docId: pl.id, x: pl.x + o.margin, y: pl.y + o.margin, w: pl.w, h: pl.h, rotated: pl.rotated };
          })
        };
      }),
      unplaced: unplaced
    };
  }

  // ---- Names ----
  function normalizeArabic(s) {
    return String(s)
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .replace(/[^\u0621-\u064Aa-zA-Z0-9\s]/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function nameTokens(s) {
    var n = normalizeArabic(s);
    return n ? n.split(" ") : [];
  }
  function levenshtein(a, b) {
    var dp = [], i, j;
    for (j = 0; j <= b.length; j++) dp[j] = j;
    for (i = 1; i <= a.length; i++) {
      var prev = dp[0]; dp[0] = i;
      for (j = 1; j <= b.length; j++) {
        var tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[b.length];
  }
  function tokenEq(x, y) {
    if (x === y) return true;
    return Math.min(x.length, y.length) >= 4 && levenshtein(x, y) <= 1;
  }
  function compareNames(a, b) {
    if (!a.length || !b.length) return "none";
    if (!tokenEq(a[0], b[0])) return "none";
    if (a.length >= 2 && b.length >= 2) return tokenEq(a[1], b[1]) ? "match" : "none";
    return "review";
  }
  function assignGroup(name, groups) {
    var tokens = nameTokens(name);
    if (!tokens.length) {
      groups.push({ id: groups.length, names: [], needsReview: true });
      return { groupId: groups.length - 1, review: true };
    }
    var best = null;
    for (var g = 0; g < groups.length && !(best && best.result === "match"); g++) {
      for (var s = 0; s < groups[g].names.length; s++) {
        var r = compareNames(tokens, groups[g].names[s]);
        if (r === "match") { best = { group: groups[g], result: "match" }; break; }
        if (r === "review" && !best) best = { group: groups[g], result: "review" };
      }
    }
    if (best && best.result === "match") { best.group.names.push(tokens); return { groupId: best.group.id, review: false }; }
    if (best && best.result === "review") { best.group.names.push(tokens); return { groupId: best.group.id, review: true }; }
    groups.push({ id: groups.length, names: [tokens], needsReview: false });
    return { groupId: groups.length - 1, review: false };
  }

  return {
    A4: A4, PAPERS: PAPERS, KINDS: KINDS, KIND_ORDER: KIND_ORDER,
    kindById: kindById, baseSize: baseSize, isBack: isBack, frontOf: frontOf,
    packAll: packAll, packBest: packBest, fitScale: fitScale, paginate: paginate,
    normalizeArabic: normalizeArabic, nameTokens: nameTokens, compareNames: compareNames,
    assignGroup: assignGroup
  };
})();
if (typeof module !== "undefined") module.exports = AK;
