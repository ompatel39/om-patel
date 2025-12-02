/**
 * Decodes a base64 string into a Uint8Array.
 * @param base64 The base64 encoded string.
 * @returns Uint8Array representing the binary data.
 */
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes raw PCM data (Int16) into an AudioBuffer.
 * This is necessary because the Gemini API returns raw PCM without headers.
 *
 * @param data The raw PCM byte data.
 * @param ctx The AudioContext to use for creating the buffer.
 * @param sampleRate The sample rate of the audio (default 24000 for Gemini TTS).
 * @param numChannels Number of channels (default 1).
 * @returns Promise resolving to an AudioBuffer.
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  // The data comes as a byte array (Uint8Array), but the underlying PCM data is 16-bit integers.
  // We need to view this buffer as Int16Array.
  // Ensure we handle byte alignment and length correctly.
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert Int16 (-32768 to 32767) to Float32 (-1.0 to 1.0)
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

/**
 * Converts an AudioBuffer to a WAV file Blob.
 * @param buffer The AudioBuffer to convert.
 * @returns A Blob containing the WAV file data.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  let result: Float32Array;
  if (numChannels === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    result = buffer.getChannelData(0);
  }

  return encodeWAV(result, format, sampleRate, numChannels, bitDepth);
}

function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);

  let index = 0;
  let inputIndex = 0;

  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function encodeWAV(samples: Float32Array, format: number, sampleRate: number, numChannels: number, bitDepth: number): Blob {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * blockAlign, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, blockAlign, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * bytesPerSample, true);

  if (format === 1) { // PCM
    floatTo16BitPCM(view, 44, samples);
  } else {
    writeFloat32(view, 44, samples);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array): void {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeFloat32(output: DataView, offset: number, input: Float32Array): void {
  for (let i = 0; i < input.length; i++, offset += 4) {
    output.setFloat32(offset, input[i], true);
  }
}

// --- Transcoding Utilities ---

export interface AudioFormat {
  label: string;
  mimeType: string;
  ext: string;
}

/**
 * Returns a list of audio formats supported by the current browser's MediaRecorder.
 */
export function getSupportedFormats(): AudioFormat[] {
  // WAV is always supported via our custom encoder
  const formats: AudioFormat[] = [
    { label: 'WAV (Uncompressed)', mimeType: 'audio/wav', ext: 'wav' }
  ];

  // Candidates for compressed formats
  const candidates = [
    { mime: 'audio/mp4', ext: 'mp4', label: 'MP4 (AAC)' },
    { mime: 'audio/webm;codecs=opus', ext: 'webm', label: 'WebM (Opus)' },
    { mime: 'audio/webm', ext: 'webm', label: 'WebM' },
    { mime: 'audio/ogg', ext: 'ogg', label: 'Ogg (Vorbis)' }
  ];

  // Check support
  if (typeof MediaRecorder !== 'undefined') {
    candidates.forEach(c => {
      if (MediaRecorder.isTypeSupported(c.mime)) {
        // Prevent duplicates (e.g. if webm;opus works, we might not need generic webm)
        // For simplicity, we just add unique mime types
        if (!formats.find(f => f.mimeType === c.mime)) {
           formats.push({ label: c.label, mimeType: c.mime, ext: c.ext });
        }
      }
    });
  }

  return formats;
}

/**
 * Transcodes an AudioBuffer to a Blob of the specified MIME type using MediaRecorder.
 * Note: This runs in real-time (1x speed) as it effectively "plays" the audio into the recorder.
 */
export async function transcodeToBlob(audioBuffer: AudioBuffer, mimeType: string): Promise<Blob> {
  // Use a separate Offline context or standard context? 
  // MediaRecorder requires a MediaStream. We can get a MediaStream from a MediaStreamDestinationNode.
  // We use a standard AudioContext (but don't connect to hardware destination) to drive the stream.
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioContextClass({ sampleRate: audioBuffer.sampleRate });
  
  const dest = ctx.createMediaStreamDestination();
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(dest);

  const recorder = new MediaRecorder(dest.stream, { mimeType });
  const chunks: Blob[] = [];

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      ctx.close();
      resolve(blob);
    };

    recorder.onerror = (e) => {
      ctx.close();
      reject(e);
    };

    // Start recording
    recorder.start();
    // Start playback into the stream
    source.start(0);

    // When the audio finishes, stop the recorder
    source.onended = () => {
      // Adding a tiny buffer time can sometimes help ensure the last chunk is flushed
      setTimeout(() => {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, 100);
    };
  });
}