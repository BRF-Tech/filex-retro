// The end-to-end driver: installs Retro into a real filex through the admin
// API (dry run first, the permission list checked against the expected one),
// then opens the DOOM-engine player and the DOS player (e2e/dos.mjs) in
// Chromium, Firefox and WebKit through filex's own pages, so every page runs
// in the real app frame under the real policy. Writes $OUT/results.json, canvas pictures and (Chromium) the
// README's screenshots. Run by e2e/run.sh in the Playwright image, sharing
// the filex container's network.
//
// Every step runs in its own browser context with a deadline: an engine that
// stops answering would otherwise hang every call into its frame and hold
// the host's build lock.

import { chromium, firefox, webkit } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pngjs from 'pngjs';
import { dosScenarios } from './dos.mjs';

const { PNG } = pngjs;
const BASE = process.env.BASE || 'http://localhost:5212';
const W = process.env.W || '/w';
const OUT = process.env.OUT || '/w/out/e2e';
const PW = fs.readFileSync(path.join(W, 'admin.pw'), 'utf8').trim();
const BROWSERS = (process.env.BROWSERS || 'chromium,firefox,webkit').split(',').filter(Boolean);
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const SAVEAS = process.env.SAVEAS === '1';
// FILEX_MIN (a version) replaces the manifest's "filex" range for an older
// filex; unset, the manifest is installed as it is.
const FILEX_MIN = process.env.FILEX_MIN || '';
const APP = 'retro';
const HDR = { Origin: BASE };
const EXPECTED_PERMISSIONS = ['files:read', 'files:write', 'ui', 'ui-viewer:.fxdoom', 'ui-viewer:.jsdos', 'ui-viewer:.wad', 'ui:package-fetch', 'ui:wasm-eval'];
const SHOTS = path.join(OUT, 'shots');
// The same names as e2e/fixtures.mjs: Chromium's pack is the README's.
const packName = (b) => (b === 'chromium' ? 'freedoom2.fxdoom' : `pack-${b}.fxdoom`);
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (n) => !ONLY.length || ONLY.includes(n);
const results = { started: new Date().toISOString(), base: BASE, filexMin: FILEX_MIN, saveAs: SAVEAS, setup: {}, browsers: {}, failures: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
let STORAGE = '';

function check(where, ok, what) {
  if (!ok) results.failures.push(`${where}: ${what}`);
  return ok;
}

function cpuUsec() {
  try {
    return Number(/usage_usec (\d+)/.exec(fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8'))[1]);
  } catch {
    return NaN;
  }
}
function colors(buf) {
  const p = PNG.sync.read(buf);
  const set = new Set();
  for (let i = 0; i < p.data.length; i += 4 * 3) set.add((p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2]);
  return set.size;
}
function diff(a, b) {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return 1;
  let d = 0;
  let n = 0;
  for (let i = 0; i < pa.data.length; i += 4 * 3) {
    n++;
    if (pa.data[i] !== pb.data[i] || pa.data[i + 1] !== pb.data[i + 1] || pa.data[i + 2] !== pb.data[i + 2]) d++;
  }
  return Math.round((d / n) * 1000) / 1000;
}
async function shot(frame, name) {
  const buf = await frame.locator('canvas.rx-screen').screenshot({ timeout: 15000 });
  fs.writeFileSync(path.join(OUT, name + '.png'), buf);
  return buf;
}

async function login(ctx) {
  const r = await ctx.request.post(BASE + '/api/auth/login', { data: { email: 'admin@local', password: PW }, headers: HDR });
  if (!r.ok()) throw new Error('login ' + r.status() + ' ' + (await r.text()));
}

async function setup(browser) {
  const ctx = await browser.newContext();
  await login(ctx);
  const storages = await (await ctx.request.get(BASE + '/api/admin/storages', { headers: HDR })).json();
  STORAGE = storages[0].name;
  const manifest = JSON.parse(fs.readFileSync(path.join(W, 'run/filex-app.json'), 'utf8'));
  const ui = fs.readFileSync(path.join(W, 'run/ui.zip'));
  results.setup.manifestFilex = manifest.filex;
  if (FILEX_MIN) manifest.filex = '>=' + FILEX_MIN;
  manifest.ui.bundle.sha256 = crypto.createHash('sha256').update(ui).digest('hex');
  results.setup.ui = { bytes: ui.length, sha256: manifest.ui.bundle.sha256 };
  const body = Buffer.from(JSON.stringify(manifest, null, 2));
  const parts = () => ({
    manifest: { name: 'filex-app.json', mimeType: 'application/json', buffer: body },
    ui: { name: 'ui.zip', mimeType: 'application/zip', buffer: ui },
  });
  const existing = await (await ctx.request.get(BASE + '/api/admin/app-plugins', { headers: HDR })).json();
  for (const p of existing.plugins || []) {
    if (p.name === APP) await ctx.request.delete(BASE + '/api/admin/app-plugins/' + p.id, { headers: HDR });
  }
  const dry = await ctx.request.post(BASE + '/api/admin/app-plugins?dry_run=1', { multipart: parts(), headers: HDR });
  const dryBody = await dry.json().catch(async () => ({ text: await dry.text() }));
  const ids = (dryBody.permissions || []).map((p) => p.id).sort();
  results.setup.dryRun = { status: dry.status(), kind: dryBody.kind, compat: dryBody.compat, file_types: dryBody.file_types, permissions: dryBody.permissions, error: dryBody.error || dryBody.message };
  check('setup', dry.ok(), 'dry run ' + dry.status());
  check('setup', JSON.stringify(ids) === JSON.stringify(EXPECTED_PERMISSIONS), 'permissions ' + JSON.stringify(ids));
  if (!dry.ok()) throw new Error('dry run ' + dry.status() + ' ' + JSON.stringify(dryBody));
  const inst = await ctx.request.post(BASE + '/api/admin/app-plugins', {
    multipart: { ...parts(), grant: JSON.stringify({ permissions: (dryBody.permissions || []).map((p) => p.id) }) },
    headers: HDR,
    timeout: 180000,
  });
  const instBody = await inst.json().catch(async () => ({ text: await inst.text() }));
  results.setup.install = { status: inst.status(), state: instBody.state, error: instBody.error || instBody.message };
  if (!inst.ok()) throw new Error('install ' + inst.status() + ' ' + JSON.stringify(instBody));
  await ctx.close();
  save();
}

function recorder(page) {
  const rec = { requests: [], failed: [], console: [], pageErrors: [] };
  page.on('request', (r) => {
    let frame = '';
    try {
      frame = r.frame().url();
    } catch {
      frame = 'worker';
    }
    rec.requests.push({ url: r.url(), method: r.method(), frame });
  });
  page.on('requestfailed', (r) => rec.failed.push({ url: r.url().slice(0, 200), err: r.failure() && r.failure().errorText }));
  page.on('console', (m) => {
    if (rec.console.length < 300) rec.console.push((m.type() + ': ' + m.text()).slice(0, 400));
  });
  page.on('pageerror', (e) => rec.pageErrors.push(String(e).slice(0, 400)));
  return rec;
}
function classify(rec, P) {
  const fromApp = rec.requests.filter((r) => r.frame.includes('/_appui/') || r.frame === 'worker');
  const outside = fromApp.filter((r) => !r.url.startsWith(P) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  return {
    appRequests: fromApp.length,
    outsidePackage: outside.map((r) => r.method + ' ' + r.url.slice(0, 160)),
    failed: rec.failed.slice(0, 20),
    pageErrors: rec.pageErrors.slice(0, 20),
    cspConsole: rec.console.filter((c) => /Content Security Policy|Refused to/i.test(c)).slice(0, 20),
    consoleErrors: rec.console.filter((c) => /^error/.test(c)).slice(0, 20),
  };
}
async function policyClean(where, frame, rec, P) {
  const net = classify(rec, P);
  const cspv = await frame.evaluate(() => window.__cspv || []).catch(() => ['(unread)']);
  check(where, cspv.length === 0 && net.cspConsole.length === 0, 'CSP violations ' + JSON.stringify(cspv.concat(net.cspConsole)));
  check(where, net.outsidePackage.length === 0, 'requests outside the package ' + JSON.stringify(net.outsidePackage));
  return { cspv, ...net };
}

async function findFrame(page) {
  for (let i = 0; i < 300; i++) {
    const f = page.frames().find((x) => x.url().includes('/_appui/'));
    if (f) return f;
    await sleep(100);
  }
  throw new Error('no app frame');
}
const settled = (frame, timeout = 60000) =>
  frame.waitForFunction(() => document.documentElement.dataset.rxState && document.documentElement.dataset.rxState !== 'loading', null, { timeout });
const look = (frame) =>
  frame.evaluate(() => {
    const ov = document.querySelector('.rx-overlay');
    return {
      state: document.documentElement.dataset.rxState,
      audio: document.documentElement.dataset.rxAudio || null,
      title: (document.querySelector('.rx-title') || {}).textContent || '',
      status: (document.querySelector('.rx-status') || {}).textContent || '',
      overlay: ov && !ov.hidden ? ov.innerText : null,
      lang: document.documentElement.lang,
    };
  });

async function openApp(ctx, file, view = 'doom') {
  const page = await ctx.newPage();
  const rec = recorder(page);
  await page.goto(`${BASE}/files/edit?path=${encodeURIComponent(STORAGE + '://' + file)}&app=${APP}/${view}`, { waitUntil: 'domcontentloaded' });
  const frame = await findFrame(page);
  await settled(frame);
  const P = frame.url().replace(/[^/]*$/, '');
  return { page, rec, frame, P };
}
async function waitState(frame, states, timeout = 30000) {
  await frame.waitForFunction((s) => s.includes(document.documentElement.dataset.rxState), states, { timeout });
  return look(frame);
}
async function newGame(page, frame) {
  await frame.click('canvas.rx-screen');
  for (const k of ['Escape', 'Enter', 'Enter']) {
    await page.keyboard.press(k);
    await sleep(700);
  }
  await sleep(1500);
}
async function saveInGame(page, frame, name) {
  await frame.click('canvas.rx-screen');
  await page.keyboard.press('F2');
  await sleep(800);
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.keyboard.type(name, { delay: 90 });
  await page.keyboard.press('Enter');
  await sleep(2200);
}

async function listNames(ctx) {
  const list = await (await ctx.request.get(BASE + '/api/files/manager?action=index&path=' + encodeURIComponent(STORAGE + '://'), { headers: HDR })).json();
  return (list.files || []).map((x) => x.basename);
}
async function nodeId(ctx, name) {
  const list = await (await ctx.request.get(BASE + '/api/files/manager?action=index&path=' + encodeURIComponent(STORAGE + '://'), { headers: HDR })).json();
  const f = (list.files || []).find((x) => x.basename === name);
  return f ? f.id : null;
}
async function versions(ctx, name) {
  const id = await nodeId(ctx, name);
  if (!id) return { id: null, count: 0 };
  const r = await ctx.request.get(BASE + '/api/files/versions?node_id=' + id, { headers: HDR });
  const body = await r.json().catch(() => null);
  const list = Array.isArray(body) ? body : (body && (body.versions || body.items)) || [];
  return { id, status: r.status(), count: list.length };
}

// ---- scenarios -------------------------------------------------------------

async function scenarioRefusals(ctx, b, out) {
  const cases = [
    ['textures.wad', 'not-wad', /Half-Life/],
    ['mod.wad', 'needs-iwad', /PWAD/],
    ['heretic.wad', 'unsupported', /Heretic/],
    ['damaged.wad', 'damaged', /damaged/],
    ['notpack.fxdoom', 'message', /not a Retro \.fxdoom pack/],
  ];
  for (const [file, state, text] of cases) {
    out.phase = file;
    const { page, frame } = await openApp(ctx, file);
    const l = await look(frame);
    out[file] = l;
    check(`${b} refusals ${file}`, l.state === state && text.test(l.overlay || ''), JSON.stringify(l));
    await page.close();
  }
}

async function scenarioPlay(ctx, b, out) {
  out.phase = 'open';
  const { page, rec, frame, P } = await openApp(ctx, 'freedoom2.wad');
  out.ready = await look(frame);
  check(`${b} play`, out.ready.state === 'ready' && /Freedoom: Phase 2/.test(out.ready.overlay || ''), 'start screen ' + JSON.stringify(out.ready));
  let c0 = cpuUsec();
  await sleep(2000);
  out.cpuIdleCores = Math.round(((cpuUsec() - c0) / 1e6 / 2) * 100) / 100;

  out.phase = 'start';
  await frame.click('[data-action="start"]');
  out.started = await waitState(frame, ['running', 'crashed', 'error', 'ended']);
  check(`${b} play`, out.started.state === 'running', 'did not run ' + JSON.stringify(out.started));
  if (out.started.state !== 'running') return;
  await sleep(4000);
  const s1 = await shot(frame, `${b}-title-1`);
  await sleep(1000);
  const s2 = await shot(frame, `${b}-title-2`);
  // The title picture stands still for a few seconds: it must only not be flat.
  out.title = { diff: diff(s1, s2), colors: colors(s2), audio: (await look(frame)).audio };
  check(`${b} play`, out.title.colors > 16, 'title screen flat ' + JSON.stringify(out.title));
  check(`${b} play`, out.title.audio === 'running', 'sound is ' + out.title.audio);

  out.phase = 'play';
  await newGame(page, frame);
  await page.keyboard.down('ArrowUp');
  await sleep(1500);
  await page.keyboard.up('ArrowUp');
  c0 = cpuUsec();
  const t0 = Date.now();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.down(i % 2 ? 'ArrowLeft' : 'ArrowRight');
    await sleep(500);
    await page.keyboard.up(i % 2 ? 'ArrowLeft' : 'ArrowRight');
    await page.keyboard.press('Control');
    await sleep(500);
  }
  out.cpuPlayCores = Math.round(((cpuUsec() - c0) / 1e6 / ((Date.now() - t0) / 1000)) * 100) / 100;
  await page.keyboard.down('ArrowLeft');
  const s3 = await shot(frame, `${b}-play-1`);
  await sleep(500);
  const s4 = await shot(frame, `${b}-play-2`);
  await page.keyboard.up('ArrowLeft');
  out.play = { diff: diff(s3, s4), colors: colors(s4), vsTitle: diff(s2, s4) };
  check(`${b} play`, out.play.diff > 0 && out.play.vsTitle > 0.2, 'play frames ' + JSON.stringify(out.play));

  out.phase = 'pause';
  await frame.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(600);
  const p1 = await shot(frame, `${b}-pause-1`);
  await sleep(1500);
  const p2 = await shot(frame, `${b}-pause-2`);
  const lp = await look(frame);
  await frame.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(1500);
  const r1 = await shot(frame, `${b}-resume-1`);
  await sleep(1000);
  const r2 = await shot(frame, `${b}-resume-2`);
  out.pause = { pausedDiff: diff(p1, p2), status: lp.status, audio: lp.audio, resumedDiff: diff(r1, r2), audioAfter: (await look(frame)).audio };
  check(`${b} pause`, out.pause.pausedDiff === 0 && out.pause.status === 'Paused' && out.pause.audio === 'suspended', 'paused ' + JSON.stringify(out.pause));
  check(`${b} pause`, out.pause.resumedDiff > 0 && out.pause.audioAfter === 'running', 'resumed ' + JSON.stringify(out.pause));

  out.phase = 'save-in-game';
  await saveInGame(page, frame, 'e2e');
  out.keep = await frame.evaluate(() => {
    const k = document.querySelector('[data-action="keep"]');
    return k ? { disabled: k.disabled } : null;
  });
  check(`${b} keep`, !!out.keep && out.keep.disabled === false, 'Keep saves is not enabled after a save ' + JSON.stringify(out.keep));
  if (SAVEAS && out.keep && !out.keep.disabled) {
    // filex 0.51+: save as opens filex's own folder dialog (the explorer's
    // Move to… dialog in its "save" mode), in the opened file's folder.
    out.phase = 'save-as';
    const before = await listNames(ctx);
    await frame.evaluate(() => delete document.documentElement.dataset.rxNote);
    await frame.click('[data-action="keep"]');
    const button = page.getByRole('button', { name: /^save here$/i }).last();
    await button.waitFor({ timeout: 20000 });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, `${b}-save-as-dialog.png`) });
    await button.click();
    await frame.waitForFunction(() => /^(success|warning|error|info): /.test(document.documentElement.dataset.rxNote || ''), null, { timeout: 60000 });
    out.keepAnswer = await frame.evaluate(() => document.documentElement.dataset.rxNote);
    const after = await listNames(ctx);
    out.newFiles = after.filter((n) => !before.includes(n));
    const made = out.newFiles.find((n) => n.endsWith('.fxdoom'));
    check(`${b} save-as`, /^success: Saved as /.test(out.keepAnswer) && !!made, 'save as ' + JSON.stringify({ note: out.keepAnswer, newFiles: out.newFiles }));
    if (made) {
      const again = await openApp(ctx, made);
      out.madePack = await look(again.frame);
      check(`${b} save-as`, /holds 1 saved game/.test(out.madePack.overlay || ''), 'the new pack ' + JSON.stringify(out.madePack));
      await again.page.close();
    }
  }
  if (!SAVEAS && out.keep && !out.keep.disabled) {
    await frame.click('[data-action="keep"]');
    await sleep(2000);
    out.keepAnswer = await frame.evaluate(() => document.documentElement.dataset.rxNote || '');
    check(`${b} keep`, /^warning: .*0\.51/.test(out.keepAnswer), 'no "needs 0.51" answer to save-as on this filex: ' + out.keepAnswer);
  }
  out.policy = await policyClean(`${b} play`, frame, rec, P);
  await page.close();
}

async function scenarioSettings(ctx, b, out) {
  out.phase = 'open';
  let { page, frame } = await openApp(ctx, 'freedoom2.wad');
  await frame.click('[data-action="settings"]');
  const music = () => frame.locator('input[data-setting="music"]');
  out.before = await music().isChecked();
  await music().uncheck();
  await sleep(1000);
  await page.close();
  ({ page, frame } = await openApp(ctx, 'freedoom2.wad'));
  await frame.click('[data-action="settings"]');
  out.afterReopen = await music().isChecked();
  out.sfxAfterReopen = await frame.locator('input[data-setting="sfx"]').isChecked();
  check(`${b} settings`, out.before === true && out.afterReopen === false && out.sfxAfterReopen === true, JSON.stringify(out));
  await music().check();
  await sleep(1000);
  await page.close();
}

// Music off stops the OPL emulation, not only its sound: the same level, no
// keys pressed, measured with music on, off, and on again.
async function scenarioMusic(ctx, b, out) {
  out.phase = 'open';
  const { page, frame } = await openApp(ctx, 'freedoom2.wad');
  await frame.click('[data-action="start"]');
  await waitState(frame, ['running']);
  await sleep(2000);
  await newGame(page, frame);
  const measure = async () => {
    await sleep(1500);
    const c0 = cpuUsec();
    const t0 = Date.now();
    await sleep(8000);
    return Math.round(((cpuUsec() - c0) / 1e6 / ((Date.now() - t0) / 1000)) * 1000) / 1000;
  };
  const music = async (on) => {
    await frame.click('[data-action="settings"]');
    const box = frame.locator('input[data-setting="music"]');
    if (on) await box.check();
    else await box.uncheck();
    await frame.click('[data-action="settings-close"]');
  };
  out.phase = 'measure';
  out.musicOn1 = await measure();
  await music(false);
  out.musicOff = await measure();
  await music(true);
  out.musicOn2 = await measure();
  out.after = await look(frame);
  check(`${b} music`, out.after.state === 'running' && out.after.audio === 'running', 'after the switches ' + JSON.stringify(out.after));
  await page.close();
}

async function scenarioPack(ctx, b, out) {
  const name = packName(b);
  out.phase = 'open';
  let { page, rec, frame, P } = await openApp(ctx, name);
  out.first = await look(frame);
  check(`${b} pack`, out.first.state === 'ready' && /no saved games/.test(out.first.overlay || ''), 'first open ' + JSON.stringify(out.first));
  out.versionsBefore = await versions(ctx, name);
  await frame.click('[data-action="start"]');
  out.started = await waitState(frame, ['running', 'crashed', 'error', 'ended']);
  if (!check(`${b} pack`, out.started.state === 'running', 'did not run ' + JSON.stringify(out.started))) return;
  await sleep(3000);
  out.phase = 'new-game';
  await newGame(page, frame);
  out.phase = 'save-in-game';
  await saveInGame(page, frame, 'pack');
  out.saveButton = await frame.evaluate(() => {
    const s = document.querySelector('[data-action="save"]');
    return s ? { disabled: s.disabled } : null;
  });
  check(`${b} pack`, !!out.saveButton && !out.saveButton.disabled, 'Save is not enabled after a save ' + JSON.stringify(out.saveButton));
  out.phase = 'save-pack';
  await frame.click('[data-action="save"]');
  await frame.waitForFunction(() => document.querySelector('[data-action="save"]').disabled && !/Saving/.test(document.querySelector('.rx-status').textContent), null, { timeout: 60000 });
  await sleep(1500);
  out.versionsAfter = await versions(ctx, name);
  check(`${b} pack`, out.versionsAfter.count > out.versionsBefore.count, 'no new version ' + JSON.stringify([out.versionsBefore, out.versionsAfter]));
  out.policy = await policyClean(`${b} pack`, frame, rec, P);
  await page.close();

  out.phase = 'reopen';
  ({ page, frame } = await openApp(ctx, name));
  out.second = await look(frame);
  check(`${b} pack`, /holds 1 saved game/.test(out.second.overlay || ''), 'reopen ' + JSON.stringify(out.second));
  await frame.click('[data-action="start"]');
  await waitState(frame, ['running', 'crashed', 'error', 'ended']);
  await sleep(3000);
  await frame.click('canvas.rx-screen');
  await page.keyboard.press('F3');
  await sleep(900);
  await shot(frame, `${b}-pack-load-menu`);
  await page.keyboard.press('Enter');
  await sleep(2500);
  out.loaded = await look(frame);
  check(`${b} pack`, out.loaded.state === 'running', 'after loading the save ' + JSON.stringify(out.loaded));
  await shot(frame, `${b}-pack-loaded`);
  await page.close();
}

// The README's pictures: filex's explorer, a double-click, the player in the
// preview (English interface, Freedoom).
async function scenarioShots(ctx, b, out) {
  const page = await ctx.newPage();
  const explore = async () => {
    await page.goto(BASE + '/drive/explore', { waitUntil: 'domcontentloaded' });
    await sleep(3500);
    const tour = page.locator('[aria-label="Onboarding tour"]');
    if (await tour.isVisible().catch(() => false)) {
      await tour.getByRole('button', { name: /skip|close|done|got it|later/i }).first().click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
      await sleep(800);
    }
    if (!(await page.getByText('freedoom2.wad', { exact: true }).first().isVisible().catch(() => false))) {
      await page.getByText(STORAGE, { exact: true }).first().click({ timeout: 10000 }).catch(() => {});
      await sleep(2500);
    }
  };
  const open = async (file) => {
    await explore();
    const row = page.getByText(file, { exact: true }).first();
    await row.waitFor({ timeout: 20000 });
    await sleep(900);
    await row.dblclick();
    const frame = await findFrame(page);
    await settled(frame);
    await sleep(800);
    return frame;
  };
  const snap = async (name) => {
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
    out.files = (out.files || []).concat(name + '.png');
  };

  out.phase = 'start';
  let frame = await open('freedoom2.wad');
  await snap('start');
  await frame.click('[data-action="start"]');
  await waitState(frame, ['running']);
  await sleep(3000);
  await newGame(page, frame);
  await page.keyboard.down('ArrowUp');
  await sleep(1200);
  await page.keyboard.up('ArrowUp');
  await sleep(800);
  await snap('playing');
  out.phase = 'settings';
  await frame.click('[data-action="settings"]');
  await sleep(500);
  await snap('settings');
  if (SAVEAS) {
    // Keep saves…: filex's own folder dialog over the preview.
    out.phase = 'keep-saves';
    await frame.click('[data-action="settings-close"]');
    await saveInGame(page, frame, 'map01');
    await frame.click('[data-action="keep"]');
    const button = page.getByRole('button', { name: /^save here$/i }).last();
    await button.waitFor({ timeout: 20000 });
    await sleep(600);
    await snap('keep-saves');
    await button.click();
    await frame.waitForFunction(() => /^(success|warning|error|info): /.test(document.documentElement.dataset.rxNote || ''), null, { timeout: 60000 });
    out.keepNote = await frame.evaluate(() => document.documentElement.dataset.rxNote);
    check(`${b} shots keep-saves`, /^success: Saved as /.test(out.keepNote), 'keep saves in the explorer: ' + out.keepNote);
  }
  out.phase = 'needs-iwad';
  frame = await open('mod.wad');
  await snap('needs-iwad');
  out.phase = 'pack';
  frame = await open(packName(b));
  await snap('pack');
  await page.close();
}

async function run() {
  const engines = { chromium, firefox, webkit };
  const launch = {
    chromium: { args: ['--autoplay-policy=user-gesture-required'] },
    firefox: { firefoxUserPrefs: { 'media.autoplay.default': 1, 'media.autoplay.blocking_policy': 0 } },
    webkit: {},
  };
  const setupBrowser = await chromium.launch();
  await setup(setupBrowser);
  await setupBrowser.close();
  for (const b of BROWSERS) {
    const r = (results.browsers[b] = {});
    const browser = await engines[b].launch(launch[b]);
    r.version = browser.version();
    let ctx = null;
    const step = async (name, fn, deadlineMs = 150000) => {
      if (!want(name)) return;
      const out = (r[name] = {});
      const t0 = Date.now();
      ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
      await ctx.addInitScript(() => {
        window.__cspv = [];
        document.addEventListener('securitypolicyviolation', (e) => window.__cspv.push(`${e.violatedDirective} ${e.blockedURI || ''}`));
      });
      await login(ctx);
      let timer;
      const deadline = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`step deadline (${deadlineMs / 1000} s); last phase ${out.phase || '?'}`)), deadlineMs);
      });
      try {
        await Promise.race([fn(out), deadline]);
      } catch (e) {
        out.error = String((e && e.stack) || e).slice(0, 1500);
        results.failures.push(`${b} ${name}: ${out.error.split('\n')[0]}`);
      }
      clearTimeout(timer);
      await Promise.race([ctx.close().catch(() => {}), sleep(15000)]);
      out.ms = Date.now() - t0;
      console.log(`[${b}] ${name} ${out.error ? 'ERROR ' + out.error.split('\n')[0] : 'ok'} (${out.ms} ms)`);
      save();
    };
    await step('refusals', (out) => scenarioRefusals(ctx, b, out));
    await step('play', (out) => scenarioPlay(ctx, b, out), 200000);
    await step('settings', (out) => scenarioSettings(ctx, b, out));
    await step('pack', (out) => scenarioPack(ctx, b, out), 240000);
    await step('music', (out) => scenarioMusic(ctx, b, out), 120000);
    if (b === 'chromium') await step('shots', (out) => scenarioShots(ctx, b, out), 200000);
    const dos = dosScenarios({ BASE, HDR, W, SHOTS, check, sleep, storage: () => STORAGE, openApp, look, waitState, shot, diff, colors, versions, policyClean, findFrame, settled });
    await step('dos-refusals', (out) => dos.refusals(ctx, b, out));
    await step('dos-roundtrip', (out) => dos.roundTrip(ctx, b, out), 200000);
    await step('dos-picker', (out) => dos.picker(ctx, b, out), 200000);
    await step('dos-chunked', (out) => dos.chunked(ctx, b, out), 200000);
    if (b === 'chromium') await step('dos-shots', (out) => dos.shots(ctx, b, out), 150000);
    await Promise.race([browser.close().catch(() => {}), sleep(20000)]);
  }
  results.finished = new Date().toISOString();
  results.ok = results.failures.length === 0;
  save();
  console.log(results.ok ? 'E2E_PASS' : 'E2E_FAIL\n' + results.failures.join('\n'));
}

run().catch((e) => {
  results.fatal = String((e && e.stack) || e);
  save();
  console.error(e);
  process.exit(1);
});
