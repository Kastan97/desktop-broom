#!/usr/bin/env node
/*
 * Desktop Broom- Freeware Problem Solver
 * A safe, undoable "smart sweep" for a messy folder (e.g. your Desktop).
 *
 * - Rules mode (default, offline, no key): sorts loose files into type buckets.
 * - AI mode (--ai, bring-your-own-key): reads content and proposes smarter
 *   category + filename for each file, the way a human would.
 *
 * NOTHING IS EVER DELETED. Every move is logged to _DesktopBroom/undo_log.tsv,
 * and `desksweep revert <folder>` puts everything back.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const readline = require('readline');

// ---------- rules: extension -> bucket ----------
const BUCKETS = {
  Images: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tiff', '.heic', '.svg'],
  PDFs: ['.pdf'],
  Documents: ['.doc', '.docx', '.txt', '.rtf', '.odt', '.pages', '.md'],
  Spreadsheets: ['.xls', '.xlsx', '.csv', '.ods', '.numbers'],
  Presentations: ['.ppt', '.pptx', '.key', '.odp'],
  Archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2'],
  Installers: ['.exe', '.msi', '.dmg', '.pkg', '.appx', '.msix', '.deb', '.rpm', '.aab', '.apk'],
  Audio: ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg'],
  Video: ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv'],
  Code: ['.js', '.ts', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.rb', '.php', '.html', '.css', '.json', '.xml', '.sh', '.ps1'],
  Data: ['.db', '.sqlite', '.log', '.dat', '.bak'],
  Shortcuts: ['.lnk', '.url'],
};
const EXT_TO_BUCKET = {};
for (const [b, exts] of Object.entries(BUCKETS)) for (const e of exts) EXT_TO_BUCKET[e] = b;

function ruleBucket(name) {
  const ext = path.extname(name).toLowerCase();
  return EXT_TO_BUCKET[ext] || 'Other';
}

// Finds the real Desktop, accounting for OneDrive folder redirection.
function findDesktop() {
  const home = os.homedir();
  const cands = [];
  if (process.env.OneDrive) cands.push(path.join(process.env.OneDrive, 'Desktop'));
  if (process.env.OneDriveConsumer) cands.push(path.join(process.env.OneDriveConsumer, 'Desktop'));
  cands.push(path.join(home, 'OneDrive', 'Desktop'));
  cands.push(path.join(home, 'Desktop'));
  if (process.env.USERPROFILE) cands.push(path.join(process.env.USERPROFILE, 'Desktop'));
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch {} }
  return path.join(home, 'Desktop');
}

// ---------- saved AI settings (bring-your-own-key) ----------
const CONFIG_PATH = path.join(os.homedir(), '.desktopbroom.json');
function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; } }
function saveConfig(c) { try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2)); return true; } catch { return false; } }

// Interactive "connect a key" flow: pick provider, paste key, optionally save.
async function setupKey() {
  console.log('\n  Connect an AI key (bring-your-own - you keep the key, you pay for usage):');
  console.log('    1) Claude  (Anthropic)   2) GPT  (OpenAI)   3) DeepSeek');
  const p = (await ask('  Pick provider [1-3]: ')).trim();
  const provider = p === '2' ? 'gpt' : p === '3' ? 'deepseek' : 'anthropic';
  const key = (await ask(`  Paste your ${provider} API key: `)).trim();
  const out = { provider, key };
  const save = (await ask('  Save this key on THIS PC for next time? (y/N): ')).trim().toLowerCase();
  if (save === 'y' || save === 'yes') {
    if (saveConfig(out)) console.log(`  Saved to ${CONFIG_PATH}  (plain text - only do this on your own machine).`);
    else console.log('  Could not save - will use it just for this run.');
  }
  return out;
}

// ---------- scan (top level only; never recurses into subfolders/repos) ----------
function scanLooseFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === 'desktop.ini' || entry.name.startsWith('_DesktopBroom')) continue;
    if (entry.name === path.basename(process.execPath)) continue; // don't move ourselves
    const full = path.join(dir, entry.name);
    let size = 0; try { size = fs.statSync(full).size; } catch {}
    out.push({ name: entry.name, full, size, ext: path.extname(entry.name).toLowerCase() });
  }
  return out;
}

// ---------- plan ----------
function rulePlan(files) {
  return files.map(f => ({ from: f.full, name: f.name, bucket: ruleBucket(f.name), newName: f.name }));
}

// small text snippet for AI context (only for text-ish files)
function snippet(f) {
  const textExt = ['.txt', '.md', '.csv', '.json', '.html', '.css', '.js', '.log', '.xml'];
  if (!textExt.includes(f.ext) || f.size > 200 * 1024) return '';
  try { return fs.readFileSync(f.full, 'utf8').slice(0, 800).replace(/\s+/g, ' '); } catch { return ''; }
}

const SYSTEM_PROMPT =
  "You organize a user's messy folder. For each file decide the best category " +
  "folder and a clear, human-readable filename (keep the original extension). " +
  "Group by PURPOSE when obvious (project, vendor, topic), otherwise by TYPE " +
  "(Images, PDFs, Documents, Installers, Archives...). Prefer few, clean " +
  "categories. Never invent facts you can't infer from the name/snippet. " +
  "Reply with ONLY a JSON array, one object per file: " +
  '{"name":<original>,"category":<folder>,"newName":<new filename with extension>}.';

// Supported AI providers (bring-your-own-key). GPT & DeepSeek share the
// OpenAI-compatible /chat/completions format; Anthropic uses /v1/messages.
const PROVIDERS = {
  anthropic: { host: 'api.anthropic.com', path: '/v1/messages', model: 'claude-haiku-4-5-20251001' },
  openai:    { host: 'api.openai.com',    path: '/v1/chat/completions', model: 'gpt-4o-mini' },
  gpt:       { host: 'api.openai.com',    path: '/v1/chat/completions', model: 'gpt-4o-mini' },
  deepseek:  { host: 'api.deepseek.com',  path: '/v1/chat/completions', model: 'deepseek-chat' },
};

function httpsPost(host, apiPath, headers, body) {
  const opts = { method: 'POST', host, path: apiPath, headers: Object.assign({ 'content-length': Buffer.byteLength(body) }, headers) };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('Bad response: ' + d.slice(0, 200))); } }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function callLLM(provider, key, model, system, user) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('Unknown provider: ' + provider + ' (use anthropic | openai | gpt | deepseek)');
  model = model || p.model;
  if (provider === 'anthropic') {
    const body = JSON.stringify({ model, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] });
    const r = await httpsPost(p.host, p.path, { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body);
    if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
    return (r.content || []).map(c => c.text || '').join('');
  } else {
    const body = JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
    const r = await httpsPost(p.host, p.path, { 'content-type': 'application/json', 'authorization': 'Bearer ' + key }, body);
    if (r.error) throw new Error((r.error.message) || JSON.stringify(r.error));
    return ((r.choices || [{}])[0].message || {}).content || '';
  }
}

async function aiPlan(files, opts) {
  const list = files.map(f => ({ name: f.name, ext: f.ext, kb: Math.round(f.size / 1024), preview: snippet(f) }));
  const text = await callLLM(opts.provider, opts.key, opts.model, SYSTEM_PROMPT, 'Files:\n' + JSON.stringify(list));
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('AI did not return JSON. Raw: ' + text.slice(0, 200));
  const byName = new Map(JSON.parse(m[0]).map(o => [o.name, o]));
  return files.map(f => {
    const o = byName.get(f.name) || {};
    return { from: f.full, name: f.name, bucket: (o.category || ruleBucket(f.name)).trim(), newName: (o.newName || f.name).trim() };
  });
}

// ---------- apply ----------
function sanitize(name) { return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim(); }

function apply(dir, plan) {
  const meta = path.join(dir, '_DesktopBroom');
  fs.mkdirSync(meta, { recursive: true });
  const undo = path.join(meta, 'undo_log.tsv');
  if (!fs.existsSync(undo)) fs.writeFileSync(undo, 'OP\tFROM\tTO\n');
  let moved = 0;
  for (const p of plan) {
    const bucketDir = path.join(dir, sanitize(p.bucket) || 'Other');
    if (!fs.existsSync(bucketDir)) { fs.mkdirSync(bucketDir, { recursive: true }); fs.appendFileSync(undo, `MKDIR\t\t${bucketDir}\n`); }
    let target = path.join(bucketDir, sanitize(p.newName) || p.name);
    if (fs.existsSync(target) && target !== p.from) {
      const ext = path.extname(target), base = target.slice(0, -ext.length || undefined);
      let i = 1; while (fs.existsSync(`${base} (${i})${ext}`)) i++; target = `${base} (${i})${ext}`;
    }
    try { fs.renameSync(p.from, target); fs.appendFileSync(undo, `MOVE\t${p.from}\t${target}\n`); moved++; }
    catch (e) { console.log('  ! skipped', p.name, '-', e.message); }
  }
  return { moved, undo };
}

function revert(dir) {
  const undo = path.join(dir, '_DesktopBroom', 'undo_log.tsv');
  if (!fs.existsSync(undo)) { console.log('No undo log found in', dir); return; }
  const lines = fs.readFileSync(undo, 'utf8').split(/\r?\n/).filter(Boolean).slice(1).reverse();
  let back = 0, rmd = 0;
  for (const line of lines) {
    const [op, from, to] = line.split('\t');
    if (op === 'MOVE' && to && fs.existsSync(to)) {
      fs.mkdirSync(path.dirname(from), { recursive: true });
      try { fs.renameSync(to, from); back++; } catch (e) { console.log('  ! revert fail', to, e.message); }
    } else if (op === 'MKDIR' && to && fs.existsSync(to)) {
      try { if (fs.readdirSync(to).length === 0) { fs.rmdirSync(to); rmd++; } } catch {}
    }
  }
  console.log(`Reverted. Files restored: ${back}  Folders removed: ${rmd}`);
}

// ---------- ui helpers ----------
function printWelcome() {
  console.log([
    '',
    '            __',
    "           /  \\        Hi! I'm Sweepy the broom. 🧹",
    '          |    |       Let me tidy your files - safely.',
    '          |    |',
    '         /|    |\\      ~ sweep ~ sweep ~',
    '        / |    | \\',
    '       *  |____|  *',
    '',
    '  HOW IT WORKS',
    '    1. You pick a folder. I look at the loose files in it.',
    '    2. I show you a PLAN first - nothing moves until you type "y".',
    '    3. I tuck files into neat folders (Images, PDFs, Documents...).',
    '',
    '  WHY IT’S SAFE  🛡️',
    '    • I NEVER delete anything. Ever. Pinky promise. 🤝',
    '    • I only touch loose files - I don’t rummage inside your',
    '      existing folders, projects, or code.',
    '    • Every move is logged, so ONE command undoes everything:',
    '          DesktopBroom.exe revert "<your folder>"',
    '    • Name clash? I add (1), (2)... I never overwrite a file.',
    '    • AI mode is optional and uses YOUR own key - off by default.',
    '',
    '  ⚠️  THE (quirky) FINE PRINT',
    '    Desktop Broom is free and provided "AS-IS" with NO warranty of any',
    '    kind. We are NOT responsible if your computer blows up, your files',
    '    stage a revolt, gremlins move in, or anything else quirky happens.',
    '    You run it, you own it. (Relax though - it only MOVES files, keeps a',
    '    full log, and can undo everything. Worst case: hit revert. 🧹)',
    '',
    '  ---------------------------------------------------------------',
    '',
  ].join('\n'));
}
function printPlan(plan) {
  const groups = {};
  for (const p of plan) (groups[p.bucket] = groups[p.bucket] || []).push(p);
  for (const b of Object.keys(groups).sort()) {
    console.log(`\n  ${b}/  (${groups[b].length})`);
    for (const p of groups[b]) console.log(`     ${p.name}${p.newName !== p.name ? '  ->  ' + p.newName : ''}`);
  }
  console.log('');
}
function ask(q) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); return new Promise(r => rl.question(q, a => { rl.close(); r(a); })); }

// ---------- main ----------
async function buildPlan(dir, useAI, opts) {
  const files = scanLooseFiles(dir);
  if (!files.length) return [];
  if (useAI) {
    if (!opts.key) throw new Error('AI mode needs a key: set DESKTOPBROOM_API_KEY (and DESKTOPBROOM_PROVIDER) or pass --key <key> --provider <anthropic|gpt|deepseek>');
    process.stdout.write(`  Asking ${opts.provider}${opts.model ? ' (' + opts.model + ')' : ''} to classify ${files.length} files... `);
    const plan = await aiPlan(files, opts); console.log('done.'); return plan;
  }
  return rulePlan(files);
}

async function main() {
  const args = process.argv.slice(2);
  const flags = { ai: args.includes('--ai'), yes: args.includes('--yes') };
  const cfg = loadConfig();
  const keyIdx = args.indexOf('--key'); const key = keyIdx >= 0 ? args[keyIdx + 1] : (process.env.DESKTOPBROOM_API_KEY || cfg.key);
  const provIdx = args.indexOf('--provider'); const provider = (provIdx >= 0 ? args[provIdx + 1] : (process.env.DESKTOPBROOM_PROVIDER || cfg.provider)) || 'anthropic';
  const modelIdx = args.indexOf('--model'); const model = modelIdx >= 0 ? args[modelIdx + 1] : (process.env.DESKTOPBROOM_MODEL || cfg.model);
  const aiOpts = { provider, key, model };
  // Only treat a flag's value as "consumed" when the flag is actually present.
  // (indexOf returns -1 when absent, and args[-1 + 1] === args[0] would wrongly
  // swallow the command word, breaking `plan/apply/revert <folder>`.)
  const consumed = new Set();
  for (const idx of [keyIdx, provIdx, modelIdx]) if (idx >= 0 && args[idx + 1]) consumed.add(args[idx + 1]);
  const positional = args.filter(a => !a.startsWith('--') && !consumed.has(a));
  const cmd = positional[0];

  console.log('\n==============================================');
  console.log('   Desktop Broom -  Freeware Problem Solver');
  console.log('==============================================');

  let command = cmd, dir = positional[1];
  if (command === 'how' || command === 'help' || command === '--help') { printWelcome(); return finish(); }
  if (command === 'setup' || command === 'connect') { await setupKey(); return finish(); }
  if (!command) { // interactive (double-clicked)
    printWelcome();
    // Ask about the AI key FIRST - and let people decline it (free mode).
    const smart = (await ask('  Connect an AI key for SMART mode?  [y] connect (Claude/GPT/DeepSeek)   [N] no thanks, free mode: ')).trim().toLowerCase();
    if (smart === 'y' || smart === 'yes') {
      flags.ai = true;
      if (aiOpts.key) console.log(`  Using your saved ${aiOpts.provider} key. (run "DesktopBroom.exe setup" to change)`);
      else Object.assign(aiOpts, await setupKey());
    } else {
      console.log('  No worries - using FREE offline rules mode. 🧹');
    }
    dir = (await ask('  Folder to organize (blank = Desktop): ')).trim().replace(/^"|"$/g, '') || findDesktop();
    command = 'plan';
  }
  if (['plan', 'apply', 'revert'].includes(command) && !dir) dir = findDesktop();
  if (!dir || !fs.existsSync(dir)) { console.log('  Folder not found:', dir); return finish(); }

  if (command === 'revert') { revert(dir); return finish(); }

  const plan = await buildPlan(dir, flags.ai, aiOpts);
  if (!plan.length) { console.log('  Nothing loose to organize in', dir); return finish(); }
  console.log(`  Plan for: ${dir}   (${plan.length} files, ${flags.ai ? 'AI:' + provider : 'rules'} mode)`);
  printPlan(plan);

  if (command === 'plan') {
    if (flags.yes) { const r = apply(dir, plan); console.log(`  Applied. Moved ${r.moved} files. Undo: ${r.undo}`); }
    else {
      const a = (await ask('  Apply this plan? (y/N): ')).trim().toLowerCase();
      if (a === 'y' || a === 'yes') { const r = apply(dir, plan); console.log(`\n  Done. Moved ${r.moved} files.\n  Undo anytime: DesktopBroom.exe revert "${dir}"`); }
      else console.log('  Cancelled. Nothing moved.');
    }
  } else if (command === 'apply') {
    const r = apply(dir, plan); console.log(`  Applied. Moved ${r.moved} files. Undo: DesktopBroom.exe revert "${dir}"`);
  }
  finish();
}
function finish() { if (process.stdout.isTTY && !process.argv.slice(2).length) { /* keep window open when double-clicked */ ask('\n  Press Enter to exit...').then(() => process.exit(0)); } }

main().catch(e => { console.error('\n  Error:', e.message); finish(); });
