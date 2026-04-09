import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AudioPlayerService {
  private static readonly STORAGE_KEY = 'audio-max-latency';
  private static readonly DEFAULT_MAX_LATENCY = 0.15;

  private audioCtx: AudioContext | null = null;
  private decoder: any = null;
  private abortController: AbortController | null = null;
  private nextStartTime = 0;
  private _isPlaying = false;
  private _maxLatency: number;

  // Background audio support — routing through <audio> element keeps iOS/Android
  // audio session alive through screen lock
  private mediaDestination: MediaStreamAudioDestinationNode | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private wakeLock: any = null;
  private visibilityHandler: (() => void) | null = null;

  constructor() {
    const stored = localStorage.getItem(AudioPlayerService.STORAGE_KEY);
    this._maxLatency = stored ? parseFloat(stored) : AudioPlayerService.DEFAULT_MAX_LATENCY;
  }

  get maxLatency(): number {
    return this._maxLatency;
  }

  set maxLatency(value: number) {
    this._maxLatency = value;
    localStorage.setItem(AudioPlayerService.STORAGE_KEY, value.toString());
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  async start(audioStreamUrl: string): Promise<void> {
    await this.stop();

    // Dynamically import opus-decoder (it's a Wasm module)
    const { OpusDecoder } = await import('opus-decoder');
    this.decoder = new OpusDecoder({ sampleRate: 48000, channels: 2 });
    await this.decoder.ready;

    this.audioCtx = new AudioContext({ sampleRate: 48000 });
    this.nextStartTime = this.audioCtx.currentTime;
    this.abortController = new AbortController();
    this._isPlaying = true;

    this.startBackgroundAudioSupport();
    this.streamAudio(audioStreamUrl);
  }

  async stop(): Promise<void> {
    this._isPlaying = false;
    this.abortController?.abort();
    this.abortController = null;

    this.stopBackgroundAudioSupport();

    if (this.decoder) {
      this.decoder.free();
      this.decoder = null;
    }

    if (this.audioCtx) {
      await this.audioCtx.close();
      this.audioCtx = null;
    }
  }

  private async streamAudio(url: string): Promise<void> {
    const maxRetries = 3;
    const retryDelay = 1000;

    for (let attempt = 0; attempt <= maxRetries && this._isPlaying; attempt++) {
      try {
        const response = await fetch(url, { signal: this.abortController!.signal });
        const reader = response.body!.getReader();
        let buffer = new Uint8Array(0);

        while (this._isPlaying) {
          const { done, value } = await reader.read();
          if (done) break;

          // Append new data to buffer
          const newBuf = new Uint8Array(buffer.length + value.length);
          newBuf.set(buffer);
          newBuf.set(value, buffer.length);
          buffer = newBuf;

          // Process complete frames (2-byte length prefix + frame data)
          while (buffer.length >= 2) {
            const frameLen = (buffer[0] << 8) | buffer[1];

            if (frameLen === 0) {
              // Keepalive — skip
              buffer = buffer.slice(2);
              continue;
            }

            if (buffer.length < 2 + frameLen) break; // wait for more data

            const frame = buffer.slice(2, 2 + frameLen);
            buffer = buffer.slice(2 + frameLen);

            this.decodeAndPlay(frame);
          }
        }
        return; // Stream ended normally
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        if (attempt < maxRetries) {
          console.warn(`Audio stream attempt ${attempt + 1} failed, retrying...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        console.error('Audio stream error:', e);
      }
    }
  }

  private decodeAndPlay(opusFrame: Uint8Array): void {
    if (!this.decoder || !this.audioCtx || !this.mediaDestination) return;

    try {
      const result = this.decoder.decodeFrame(opusFrame);
      if (!result || result.samplesDecoded === 0) return;

      const { channelData, samplesDecoded, sampleRate } = result;
      const audioBuffer = this.audioCtx.createBuffer(
        channelData.length,
        samplesDecoded,
        sampleRate,
      );

      for (let ch = 0; ch < channelData.length; ch++) {
        audioBuffer.copyToChannel(channelData[ch], ch);
      }

      const source = this.audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      // Route through MediaStreamDestination → <audio> element so the OS
      // treats this as active media playback (survives screen lock)
      source.connect(this.mediaDestination);

      // Schedule playback to maintain continuity
      const now = this.audioCtx.currentTime;
      const maxLatency = this._maxLatency;

      if (this.nextStartTime < now) {
        // Fell behind — catch up to now
        this.nextStartTime = now;
      } else if (this.nextStartTime - now > maxLatency) {
        // Too far ahead — drop back to reduce latency
        this.nextStartTime = now + 0.02;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += samplesDecoded / sampleRate;
    } catch {
      // Decoder errors on individual frames are non-fatal
    }
  }

  /**
   * Routes decoded audio through an <audio> element so iOS/Android treat it
   * as media playback that survives screen lock.
   *
   * Web Audio API alone (AudioContext.destination) gets suspended on lock.
   * But an <audio> element playing a MediaStream keeps the audio session alive.
   */
  private startBackgroundAudioSupport(): void {
    if (!this.audioCtx) return;

    // 1. Create a MediaStream destination — decoded audio goes here instead
    //    of audioCtx.destination
    this.mediaDestination = this.audioCtx.createMediaStreamDestination();

    // 2. Play the MediaStream through an <audio> element — this is what
    //    keeps the OS audio session alive through screen lock
    this.audioElement = document.createElement('audio');
    this.audioElement.srcObject = this.mediaDestination.stream;
    this.audioElement.play().catch(() => {});

    // 3. MediaSession — lock-screen metadata and pause control
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Private Listening',
        artist: 'Roku Remote',
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        this.stop();
      });
      navigator.mediaSession.setActionHandler('play', () => {
        // No-op: restarting requires proxy coordination
      });
    }

    // 4. Resume AudioContext if the OS suspended it when returning from background
    this.visibilityHandler = () => {
      if (this.audioCtx?.state === 'suspended') {
        this.audioCtx.resume();
      }
      // Re-play audio element in case iOS paused it
      if (this.audioElement?.paused && this._isPlaying) {
        this.audioElement.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // 5. Wake Lock — prevents auto screen-off on Android
    this.requestWakeLock();
  }

  private stopBackgroundAudioSupport(): void {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }

    this.mediaDestination = null;

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('play', null);
    }

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }

    this.releaseWakeLock();
  }

  private async requestWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          if (this._isPlaying) {
            this.requestWakeLock();
          }
        });
      }
    } catch {
      // Wake Lock not available or denied — non-critical
    }
  }

  private releaseWakeLock(): void {
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }
}
