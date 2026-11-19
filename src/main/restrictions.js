'use strict';
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const run = promisify(execFile);

// Never touched, even if a user types them in. Keeps Windows usable and recoverable.
const PROTECTED = new Set([
  'explorer.exe', 'taskmgr.exe', 'securityhealthsystray.exe', 'securityhealthservice.exe',
  'msmpeng.exe', 'nissrv.exe', 'smartscreen.exe', 'winlogon.exe', 'csrss.exe', 'wininit.exe',
  'services.exe', 'lsass.exe', 'svchost.exe', 'dwm.exe', 'fontdrvhost.exe', 'sihost.exe',
  'shellexperiencehost.exe', 'startmenuexperiencehost.exe', 'searchhost.exe', 'runtimebroker.exe',
  'ctfmon.exe', 'shutdown.exe', 'sethc.exe', 'utilman.exe', 'narrator.exe', 'magnify.exe',
  'osk.exe', 'werfault.exe', 'msedgewebview2.exe', 'systemsettings.exe', 'cmd.exe',
  'powershell.exe', 'mmc.exe', 'regedit.exe', 'rstrui.exe', 'electron.exe', 'system',
]);
const ROBLOX = ['RobloxPlayerBeta.exe', 'RobloxPlayerLauncher.exe', 'RobloxStudioBeta.exe'];
const STEAM = ['steam.exe', 'steamwebhelper.exe']; // steamservice.exe is a Windows service: left alone
const CATALOG = [
  { id: 'word', label: 'Word', exes: ['WINWORD.EXE'] },
  { id: 'excel', label: 'Excel', exes: ['EXCEL.EXE'] },
  { id: 'powerpoint', label: 'PowerPoint', exes: ['POWERPNT.EXE'] },
  { id: 'outlook', label: 'Outlook', exes: ['OUTLOOK.EXE'] },
  { id: 'onenote', label: 'OneNote', exes: ['ONENOTE.EXE'] },
  { id: 'teams', label: 'Teams', exes: ['ms-teams.exe', 'Teams.exe'] },
  { id: 'edge', label: 'Microsoft Edge', exes: ['msedge.exe'] },
  { id: 'xbox', label: 'Xbox app', exes: ['XboxPcApp.exe'] },
  { id: 'skype', label: 'Skype', exes: ['Skype.exe'] },
];
const GRACE_MS = 8000;

function parseTasklist(csv) {
  const out = [];
  for (const line of csv.split(/\r?\n/)) {
    const m = line.match(/^"([^"]*)","(\d+)"/);
    if (m) out.push({ name: m[1], pid: Number(m[2]) });
  }
  return out;
}

function buildTargets(settings, selfName = '') {
  const r = settings.restrictions;
  if (!r.enabled) return new Set();
  const names = [];
  if (r.roblox) names.push(...ROBLOX);
  if (r.steam) names.push(...STEAM);
  for (const id of r.microsoft) names.push(...(CATALOG.find((c) => c.id === id)?.exes || []));
  names.push(...r.custom);
  return new Set(names.map((n) => n.toLowerCase()).filter((n) => !PROTECTED.has(n) && n !== selfName));
}

/**
 * User-level enforcement only: while a session is active, matching processes are asked to close,
 * then force-closed after a grace period (if enabled). No services, registry or policy changes are
 * made, so there is nothing to undo: stop() (or simply quitting the app) restores normal access.
 */
class Restrictor {
  constructor({ getSettings, onStatus = () => {}, platform = process.platform, list, kill }) {
    Object.assign(this, { getSettings, onStatus, platform });
    this._list = list || (async () => parseTasklist((await run('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000, maxBuffer: 4e6 })).stdout));
    this._kill = kill || ((pid, force) => run('taskkill', ['/PID', String(pid), ...(force ? ['/F'] : [])], { windowsHide: true, timeout: 8000 }));
    this.selfName = path.basename(process.execPath).toLowerCase();
    this.active = false; this.busy = false; this.timer = null;
    this.firstSeen = new Map(); this.denied = new Set(); this.closed = 0;
  }
  start() {
    if (this.active) return;
    this.active = true; this.closed = 0; this.denied.clear(); this.firstSeen.clear();
    this.poll();
    this.timer = setInterval(() => this.poll(), 2000);
  }
  stop() {
    this.active = false;
    clearInterval(this.timer); this.timer = null;
    this.firstSeen.clear(); this.denied.clear();
    this.onStatus();
  }
  status() { return { active: this.active, closed: this.closed, denied: [...this.denied] }; }

  async poll() {
    if (!this.active || this.busy || this.platform !== 'win32') return;
    this.busy = true;
    try {
      const s = this.getSettings();
      const targets = buildTargets(s, this.selfName);
      if (!targets.size) return;
      const hits = (await this._list()).filter((p) => targets.has(p.name.toLowerCase()) && p.pid !== process.pid);
      const live = new Set(hits.map((p) => p.pid));
      for (const pid of [...this.firstSeen.keys()]) if (!live.has(pid)) { this.firstSeen.delete(pid); this.closed++; }
      for (const p of hits) {
        const seen = this.firstSeen.get(p.pid);
        const force = seen !== undefined && s.restrictions.forceClose && Date.now() - seen >= GRACE_MS;
        if (seen === undefined) this.firstSeen.set(p.pid, Date.now());
        else if (!force) continue;
        try { await this._kill(p.pid, force); this.denied.delete(p.name); }
        catch (e) {
          const msg = `${e.stderr || ''}${e.message || ''}`;
          if (/denied/i.test(msg)) this.denied.add(p.name);
          else if (/forcefully/i.test(msg) && s.restrictions.forceClose) { try { await this._kill(p.pid, true); } catch { /* gone or protected */ } }
        }
      }
    } catch { /* tasklist failed: try again next poll */ }
    finally { this.busy = false; this.onStatus(); }
  }
}
module.exports = { Restrictor, buildTargets, parseTasklist, PROTECTED, CATALOG };
