// Document type from the text printed on it (OCR) plus simple shape/colour cues. No training.
var CLS = (function () {
  function norm(t) {
    return String(t).replace(/[\u064B-\u065F\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase().replace(/\s+/g, " ");
  }
  // [keyword, weight]
  var RULES = {
    national_id_back: [["idirq", 3], ["تاريخ الاصدار", 2], ["تاريخ النفاذ", 2], ["جهه الاصدار", 2], ["محل الولاده", 1], ["الرقم العائلي", 2]],
    national_id_front: [["البطاقه الوطنيه", 3], ["فصيله الدم", 2], ["اللقب", 1], ["الجد", 1], ["مديريه الجنسيه العامه", 1], ["الاسم", 1]],
    housing_back: [["تنظيم الاستماره", 3], ["منظم الاستماره", 3], ["نموذج", 1]],
    housing_front: [["مكتب معلومات", 3], ["مكتب المعلومات", 3], ["عنوان السكن", 3], ["رقم الاستماره", 2], ["اسم رب الاسره", 1]],
    ration_card: [["الالكترونيه", 3], ["كارتي", 1]],
    ration_paper: [["عدد افراد الاسره", 3], ["افراد الاسره", 2], ["بطاقه تمويه", 2], ["البطاقه التمونيه", 2], ["التمويه", 1]],
    nationality: [["شهاده الجنسيه", 3], ["مدير الجنسيه", 3], ["الجنسيه العراقيه", 2]],
    passport: [["passport", 3], ["p<irq", 3]]
  };
  function scoreText(text) {
    var t = norm(text), out = {};
    Object.keys(RULES).forEach(function (type) {
      var s = 0; RULES[type].forEach(function (k) { if (t.indexOf(norm(k[0])) >= 0) s += k[1]; });
      if (s) out[type] = s;
    });
    return out;
  }
  // Pale yellow-green halo of the housing-card emblem (bank cards are darker green).
  function greenHalo(img) {
    var d = img.data, n = img.width * img.height, step = Math.max(1, Math.floor(n / 20000)), hit = 0, tot = 0;
    for (var i = 0; i < n; i += step) {
      var r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx, s = mx ? (mx - mn) / mx : 0, h = 0;
      if (mx !== mn) { var dd = mx - mn; h = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h *= 60; if (h < 0) h += 360; }
      tot++; if (h >= 60 && h <= 120 && s >= 0.22 && s <= 0.8 && v >= 0.6) hit++;
    }
    return hit / Math.max(1, tot);
  }
  // info: {text, ar, halo}. Returns {type, sure}
  function decide(info) {
    var sc = scoreText(info.text || ""), keys = Object.keys(sc).sort(function (a, b) { return sc[b] - sc[a]; });
    if (keys.length && (keys.length === 1 || sc[keys[0]] > sc[keys[1]])) return { type: keys[0], sure: sc[keys[0]] >= 2, scores: sc };
    if (info.ar > 2.4) return { type: "ration_paper", sure: false, scores: sc };
    if (info.halo > 0.035) return { type: "housing_front", sure: false, scores: sc };
    return { type: "other", sure: false, scores: sc };
  }
  return { decide: decide, scoreText: scoreText, greenHalo: greenHalo };
})();
if (typeof module !== "undefined") module.exports = CLS;
