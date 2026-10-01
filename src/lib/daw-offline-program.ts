// Only application-owned code is put in the private renderer program. Audio,
// settings and paths are data; no student/song text is evaluated as JavaScript.
export const offlinePreload = `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bounce', {
  info: () => ipcRenderer.invoke('info'),
  read: (track, offset, count) => ipcRenderer.invoke('read', track, offset, count),
  write: (offset, bytes) => ipcRenderer.invoke('write', offset, bytes),
  done: () => ipcRenderer.invoke('done'),
  fail: message => ipcRenderer.invoke('fail', String(message).slice(0, 2000))
});
`;

export const offlineMain = `
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const job = JSON.parse(fs.readFileSync(path.join(__dirname, 'job.json'), 'utf8'));
app.setPath('userData', path.join(__dirname, 'profile'));
app.setName('Songzu Offline Audio');
app.disableHardwareAcceleration();
app.enableSandbox();
app.commandLine.appendSwitch('disable-background-networking');
let window, inputs = [], output, written = 0, peak = 0, finished = false, requests = 0;
const fail = error => {
  if (finished) return;
  finished = true;
  fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify({ error: String(error), requests }));
  app.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
const watchdog = setTimeout(() => fail('Offline rendering deadline exceeded'), job.timeoutMs);
setInterval(() => {
  try { process.kill(job.parentPid, 0); } catch { fail('Render owner exited'); }
}, 1000).unref();
const checkSender = event => {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('Invalid renderer sender');
};
const integer = value => Number.isSafeInteger(value) && value >= 0;
app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
  const ses = session.fromPartition('offline-audio');
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url === 'about:blank' || details.url === job.url;
    if (!allowed) requests++;
    callback({ cancel: !allowed });
  });
  window = new BrowserWindow({ show: false, webPreferences: {
    session: ses, preload: path.join(__dirname, 'preload.cjs'),
    sandbox: true, contextIsolation: true, nodeIntegration: false,
    backgroundThrottling: false, webSecurity: true
  }});
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => fail('Renderer exited: ' + details.reason));
  inputs = job.tracks.map(track => fs.openSync(track.path, 'r'));
  output = fs.openSync(path.join(__dirname, 'output.f32'), 'wx', 0o600);
  ipcMain.handle('info', event => {
    checkSender(event);
    return { frames: job.frames, sampleRate: job.sampleRate, tracks: job.tracks.map(({ path, ...track }) => track), master: job.master, masterOnly: job.masterOnly, channelOnly: job.channelOnly };
  });
  ipcMain.handle('read', (event, track, offset, count) => {
    checkSender(event);
    if (!integer(track) || track >= job.tracks.length || !integer(offset) || !integer(count) || count > 65536 || offset + count > job.tracks[track].frames) throw Error('PCM read out of bounds');
    const data = Buffer.alloc(count * 8);
    if (fs.readSync(inputs[track], data, 0, data.length, offset * 8) !== data.length) throw Error('Truncated PCM input');
    return data;
  });
  ipcMain.handle('write', (event, offset, data) => {
    checkSender(event);
    if (!(data instanceof ArrayBuffer) || !integer(offset) || offset * 8 !== written || data.byteLength === 0 || data.byteLength % 8 || data.byteLength > 65536 * 8 || written + data.byteLength > job.frames * 8) throw Error('PCM output out of bounds');
    const bytes = Buffer.from(data);
    for (let i = 0; i < bytes.length; i += 4) {
      const value = bytes.readFloatLE(i);
      if (!Number.isFinite(value)) throw Error('Non-finite PCM output');
      peak = Math.max(peak, Math.abs(value));
    }
    let position = 0;
    while (position < bytes.length) {
      const count = fs.writeSync(output, bytes, position, bytes.length - position);
      if (!count) throw Error('PCM output write failed');
      position += count;
    }
    written += bytes.length;
  });
  ipcMain.handle('done', event => {
    checkSender(event);
    if (finished || written !== job.frames * 8 || requests) throw Error('Incomplete or non-isolated render');
    fs.fsyncSync(output); fs.closeSync(output); output = undefined;
    for (const input of inputs) fs.closeSync(input); inputs = [];
    fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify({ frames: job.frames, sampleRate: job.sampleRate, peak, requests, chromium: process.versions.chrome, electron: process.versions.electron }));
    finished = true;
    clearTimeout(watchdog);
    setImmediate(() => app.exit(0));
  });
  ipcMain.handle('fail', (event, message) => { checkSender(event); fail(message); });
  await window.loadURL(job.url);
});
`;

export function offlineRenderer(channelFactory: string, trackFactory: string, masterFactory: string, masterSettings: unknown) {
  return `
  window.fetch = () => Promise.reject(new Error('Offline renderer has no network'));
  navigator.sendBeacon = () => false;
  (async () => {
    const job = await window.bounce.info();
    const context = new OfflineAudioContext(2, job.frames, job.sampleRate);
    const master = (${masterFactory})(context, !job.master, ${JSON.stringify(masterSettings)});
    for (let index = 0; index < job.tracks.length; index++) {
      const track = job.tracks[index];
      const buffer = context.createBuffer(2, track.frames, job.sampleRate);
      for (let offset = 0; offset < track.frames; offset += 65536) {
        const count = Math.min(65536, track.frames - offset);
        const bytes = await window.bounce.read(index, offset, count);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < count; i++) for (let c = 0; c < 2; c++) {
          const value = view.getFloat32(i * 8 + c * 4, true);
          if (!Number.isFinite(value)) throw Error('Non-finite PCM input');
          buffer.getChannelData(c)[offset + i] = value;
        }
      }
      let destination = master.input;
      if (!job.channelOnly) {
        const bus = (${trackFactory})(context, { volume: track.volume, pan: track.pan, polarityInverted: false, stereoMode: 'stereo' }, true);
        bus.analyser.connect(master.input);
        destination = bus.input;
      }
      const input = context.createGain();
      if (job.masterOnly) input.connect(destination);
      else (${channelFactory})(context, input, track.settings, destination);
      for (const range of track.ranges) {
        const source = context.createBufferSource(); source.buffer = buffer;
        source.connect(input);
        source.start(range.start / job.sampleRate, range.start / job.sampleRate, (range.end - range.start) / job.sampleRate);
      }
    }
    const result = await context.startRendering();
    for (let offset = 0; offset < result.length; offset += 65536) {
      const count = Math.min(65536, result.length - offset);
      const bytes = new ArrayBuffer(count * 8), view = new DataView(bytes);
      for (let i = 0; i < count; i++) for (let c = 0; c < 2; c++) view.setFloat32(i * 8 + c * 4, result.getChannelData(c)[offset + i], true);
      await window.bounce.write(offset, bytes);
    }
    await window.bounce.done();
  })().catch(error => window.bounce.fail(error.stack || String(error)));
  `;
}
