// Runs document detection (OpenCV) in a separate thread so the page never freezes.
var status = function (s) { self.postMessage({ type: 'status', text: s }); };
var det = null, initPromise = null;

function init() {
  if (initPromise) return initPromise;
  initPromise = new Promise(function (resolve, reject) {
    try {
      status('loading');
      importScripts('./lib/opencv.js', './detect_core.js');
    } catch (e) { reject(new Error('import failed: ' + e)); return; }
    var t0 = Date.now(), done = false;
    function ok() { if (done) return; done = true; try { det = createDetector(self.cv); status('ready'); resolve(); } catch (e) { reject(e); } }
    try { if (self.cv) self.cv.onRuntimeInitialized = ok; } catch (e) {}
    (function poll() {
      if (done) return;
      if (self.cv && self.cv.Mat) return ok();
      if (Date.now() - t0 > 120000) { done = true; return reject(new Error('opencv init timeout')); }
      setTimeout(poll, 100);
    })();
  });
  return initPromise;
}

self.onmessage = function (e) {
  var m = e.data;
  if (m.type === 'init') { init().catch(function (err) { status('failed: ' + err.message); }); return; }
  init().then(function () {
    var docs = det.run({ data: new Uint8ClampedArray(m.buffer), width: m.width, height: m.height });
    var out = docs.map(function (d) { return { src: d.src, ar: d.ar, width: d.img.width, height: d.img.height, buffer: d.img.data.buffer }; });
    self.postMessage({ id: m.id, docs: out }, out.map(function (d) { return d.buffer; }));
  }).catch(function (err) {
    self.postMessage({ id: m.id, error: String(err && err.message || err) });
  });
};
