export function validateInputChannels(available: number, start: number, count: number) {
  if (!Number.isInteger(start) || start < 0 || ![1, 2].includes(count) ||
    !Number.isInteger(available) || available < start + count || available > 32) {
    throw new Error(`無法獨立擷取 Input ${start + 1}${count === 2 ? `-${start + count}` : ""}；請確認裝置聲道，或使用原生錄音引擎。`);
  }
}

// Split before any mono node: Web Audio's default speaker downmix combines inputs.
export function createDiscreteAudioInput(context: AudioContext, stream: MediaStream, start = 0, count = 1) {
  const tracks = stream.getAudioTracks();
  const track = tracks[0];
  if (tracks.length !== 1 || !track || track.readyState !== "live") {
    throw new Error("錄音需要一個有效且明確的輸入串流。");
  }
  const available = track.getSettings().channelCount;
  validateInputChannels(available ?? 0, start, count);
  const source = context.createMediaStreamSource(stream);
  const splitter = context.createChannelSplitter(available!);
  const output = context.createChannelMerger(count);
  source.connect(splitter);
  for (let channel = 0;channel < count;channel += 1) splitter.connect(output, start + channel, channel);
  return {
    output, nodes: [source, splitter, output], disconnect: () => {
      source.disconnect();
      splitter.disconnect();
      output.disconnect();
    }
  };
}
