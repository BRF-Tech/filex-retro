// Loads js-dos 8.5.1's `emulators` from this app's own package and starts
// DOSBox in a worker.
//
// Under filex's policy for app pages (no 'unsafe-eval', `worker-src blob:`,
// `connect-src` = the package's own path) `emulators` cannot start as it
// ships: it loads the Emscripten glue with XMLHttpRequest and runs it with
// `eval` (src/impl/modules.ts). It first looks in `window.compiled[<NAME>]`
// for an already compiled module, so that is filled in here without eval -
// the glue comes in as a <script> from the package (it declares a global
// factory, WDOSBOX / WLIBZIP) and the wasm is compiled from the package with
// fetch (measured in Chromium, Firefox and WebKit). The worker is
// js-dos's own: it fetches the glue from the package and starts it from a
// blob: address, and the compiled module is handed to it.
//
// Only the single-threaded `dosbox` backend: DOSBox-X needs a
// SharedArrayBuffer, which a frame that is not cross-origin isolated does not
// have. No network, no IPX, no cloud, no sockdrive: none is asked for.

export const EMULATORS_DIR = 'dos/emulators/';

export function loadScript(doc, src) {
  return new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('could not load ' + src.split('/').pop()));
    doc.head.appendChild(s);
  });
}

async function precompile(win, doc, prefix, base, globalName) {
  await loadScript(doc, prefix + base + '.js');
  const factory = win[globalName];
  if (typeof factory !== 'function') throw new Error(globalName + ' is missing from ' + base + '.js');
  const resp = await win.fetch(prefix + base + '.wasm');
  if (!resp.ok) throw new Error(base + '.wasm: HTTP ' + resp.status);
  const wasmModule = await win.WebAssembly.compile(await resp.arrayBuffer());
  const instantiateWasm = (info, receiveInstance) => {
    info.env = info.env || {};
    return win.WebAssembly.instantiate(wasmModule, info).then((instance) => receiveInstance(instance, wasmModule));
  };
  win.compiled[globalName] = Promise.resolve({
    wasmModule,
    async instantiate(initialModule) {
      initialModule.instantiateWasm = instantiateWasm;
      await factory(initialModule);
    },
  });
}

let loading = null;

/** `window.emulators`, loaded from `prefix` (the package's dos/emulators/ address) and ready to start. */
export function loadEmulators(doc, prefix) {
  if (!loading) {
    loading = (async () => {
      const win = doc.defaultView;
      await loadScript(doc, prefix + 'emulators.js');
      const emulators = win.emulators;
      if (!emulators || typeof emulators.dosboxWorker !== 'function') throw new Error('emulators.js did not load');
      emulators.pathPrefix = prefix;
      emulators.pathSuffix = '';
      win.compiled = win.compiled || {};
      win.module = win.module || {};
      win.exports = win.exports || {};
      await precompile(win, doc, prefix, 'wlibzip', 'WLIBZIP');
      await precompile(win, doc, prefix, 'wdosbox', 'WDOSBOX');
      return emulators;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/**
 * Start DOSBox on `bundle` (bytes; a copy is handed over - js-dos transfers
 * the buffer it is given) with `conf` (the DOSBox configuration text to use
 * when the bundle has none, or null). Answers js-dos's CommandInterface.
 */
export function startDos(emulators, bundle, conf) {
  const init = [bundle.slice()];
  if (conf) init.push(conf);
  return emulators.dosboxWorker(init, {});
}
