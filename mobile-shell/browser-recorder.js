(() => {
  const databaseName = "songzu-mobile-recordings";
  const storeName = "recordings";
  const maxDurationSeconds = 5 * 60;
  let active = null;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("無法開啟手機錄音保存空間。"));
    });
  }

  async function storeTransaction(mode, operation) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = operation(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("手機錄音保存失敗。"));
      });
    } finally {
      database.close();
    }
  }

  function pcm24(samples) {
    const bytes = new Uint8Array(samples.length * 3);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < samples.length; index += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[index]));
      let value = Math.round(clamped < 0 ? clamped * 0x800000 : clamped * 0x7fffff);
      if (value < 0) value += 0x1000000;
      const offset = index * 3;
      view.setUint8(offset, value & 0xff);
      view.setUint8(offset + 1, (value >> 8) & 0xff);
      view.setUint8(offset + 2, (value >> 16) & 0xff);
    }
    return bytes;
  }

  function wavHeader(dataBytes, sampleRate, channels = 1, bitDepth = 24) {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * (bitDepth / 8), true);
    view.setUint16(32, channels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    text(36, "data");
    view.setUint32(40, dataBytes, true);
    return buffer;
  }

  function safeName(value) {
    return String(value || "手機錄音").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 48) || "手機錄音";
  }

  function hex(bytes) {
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  function publicRecord(record) {
    const metadata = { ...record };
    delete metadata.blob;
    return metadata;
  }

  function consumeSamples(samples) {
    if (!active || !samples?.length || active.stopping) return;
    active.chunks.push(pcm24(samples));
    active.frames += samples.length;
    let peak = 0;
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const absolute = Math.abs(samples[index]);
      peak = Math.max(peak, absolute);
      sum += samples[index] * samples[index];
    }
    active.level = Math.min(1, Math.sqrt(sum / samples.length) * 3.4);
    active.peakPowerDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    if (active.frames / active.sampleRate >= maxDurationSeconds && !active.autoStopping) {
      active.autoStopping = true;
      active.error = "已達 5 分鐘安全上限，正在自動保存 WAV";
      window.setTimeout(() => void api.stop(), 0);
    }
  }

  async function createCaptureNode(context, source) {
    if (context.audioWorklet) {
      try {
        await context.audioWorklet.addModule(new URL("pcm-worklet.js", document.baseURI).toString());
        const node = new AudioWorkletNode(context, "songzu-pcm-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = (event) => consumeSamples(event.data);
        source.connect(node);
        return node;
      } catch {
        // Older embedded browsers use the compatible ScriptProcessor fallback.
      }
    }
    const node = context.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (event) => consumeSamples(event.inputBuffer.getChannelData(0));
    source.connect(node);
    return node;
  }

  const api = {
    async capabilities() {
      return {
        engine: "browser_pcm_wav",
        inputAvailable: Boolean(navigator.mediaDevices?.getUserMedia && window.AudioContext),
        preferredSampleRate: 48000,
        preferredBitDepth: 24,
        maxDurationSeconds
      };
    },

    async start(options = {}) {
      if (active) throw new Error("已有一段錄音正在進行。");
      if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(location.hostname)) {
        throw new Error("手機瀏覽器錄音需要 HTTPS 安全連線。");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false
      });
      const context = new AudioContext({ sampleRate: Number(options.sampleRate || 48000), latencyHint: "interactive" });
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const captureNode = await createCaptureNode(context, source);
      const mute = context.createGain();
      mute.gain.value = 0;
      captureNode.connect(mute);
      mute.connect(context.destination);
      const track = stream.getAudioTracks()[0];
      active = {
        id: crypto.randomUUID(),
        label: safeName(options.label),
        startedAt: Date.now(),
        sampleRate: context.sampleRate,
        bitDepth: 24,
        channels: 1,
        chunks: [],
        frames: 0,
        level: 0,
        peakPowerDb: -Infinity,
        inputDeviceLabel: track?.label || "手機麥克風",
        context,
        stream,
        source,
        captureNode,
        mute,
        stopping: false,
        autoStopping: false,
        error: null
      };
      return api.status();
    },

    async status() {
      if (!active) return { recording: false, level: 0, peakPowerDb: -Infinity };
      return {
        recording: !active.stopping,
        id: active.id,
        elapsedSeconds: active.frames / active.sampleRate,
        level: active.level,
        peakPowerDb: active.peakPowerDb,
        sampleRate: active.sampleRate,
        bitDepth: active.bitDepth,
        channels: active.channels,
        inputDeviceLabel: active.inputDeviceLabel,
        error: active.error
      };
    },

    async stop() {
      if (!active) throw new Error("目前沒有進行中的錄音。");
      const recording = active;
      recording.stopping = true;
      active = null;
      recording.captureNode.disconnect();
      recording.source.disconnect();
      recording.mute.disconnect();
      recording.stream.getTracks().forEach((track) => track.stop());
      await recording.context.close();
      const dataBytes = recording.chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      const blob = new Blob([wavHeader(dataBytes, recording.sampleRate), ...recording.chunks], { type: "audio/wav" });
      const sha256 = hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
      const createdAt = new Date().toISOString();
      const fileName = `${recording.label}-${createdAt.replace(/[:.]/g, "-")}.wav`;
      const record = {
        id: recording.id,
        label: recording.label,
        fileName,
        fileSizeBytes: blob.size,
        sha256,
        durationSeconds: recording.frames / recording.sampleRate,
        sampleRate: recording.sampleRate,
        bitDepth: 24,
        channels: 1,
        inputDeviceLabel: recording.inputDeviceLabel,
        createdAt,
        uploaded: false,
        uploadedAt: null,
        serverAudioFileId: null,
        captureEngine: "browser_pcm_wav",
        blob
      };
      await storeTransaction("readwrite", (store) => store.put(record));
      return publicRecord(record);
    },

    async list() {
      const records = await storeTransaction("readonly", (store) => store.getAll());
      return { recordings: records.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))).map(publicRecord) };
    },

    async readChunk({ id, offset = 0, length = 1048576 }) {
      const record = await storeTransaction("readonly", (store) => store.get(id));
      if (!record?.blob) throw new Error("找不到這段手機 WAV 原檔。");
      const bytes = new Uint8Array(await record.blob.slice(offset, offset + length).arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
      return { data: btoa(binary), offset, length: bytes.length };
    },

    async markUploaded({ id, serverAudioFileId }) {
      const record = await storeTransaction("readonly", (store) => store.get(id));
      if (!record) throw new Error("找不到這段手機錄音。");
      record.uploaded = true;
      record.uploadedAt = new Date().toISOString();
      record.serverAudioFileId = serverAudioFileId || null;
      await storeTransaction("readwrite", (store) => store.put(record));
      return publicRecord(record);
    }
  };

  window.SongzuBrowserRecorder = api;
})();
