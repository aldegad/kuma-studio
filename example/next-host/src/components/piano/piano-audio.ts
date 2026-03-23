"use client";

type Voice = {
  gainNode: GainNode;
  oscillators: OscillatorNode[];
};

export class PianoAudio {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private voices = new Map<string, Voice>();

  private async ensureContext() {
    if (!this.context) {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("This browser does not support Web Audio.");
      }

      this.context = new AudioContextCtor();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.82;
      this.masterGain.connect(this.context.destination);
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    return this.context;
  }

  async playNote(id: string, frequency: number) {
    const context = await this.ensureContext();
    if (!this.masterGain) {
      return;
    }

    if (this.voices.has(id)) {
      return;
    }

    const now = context.currentTime;
    const noteGain = context.createGain();
    noteGain.gain.setValueAtTime(0.0001, now);
    noteGain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    noteGain.gain.exponentialRampToValueAtTime(0.12, now + 0.18);
    noteGain.connect(this.masterGain);

    const fundamental = context.createOscillator();
    fundamental.type = "triangle";
    fundamental.frequency.setValueAtTime(frequency, now);

    const shimmer = context.createOscillator();
    shimmer.type = "sine";
    shimmer.frequency.setValueAtTime(frequency * 2, now);

    const lowShelf = context.createBiquadFilter();
    lowShelf.type = "lowpass";
    lowShelf.frequency.setValueAtTime(2200, now);

    fundamental.connect(lowShelf);
    shimmer.connect(lowShelf);
    lowShelf.connect(noteGain);

    fundamental.start(now);
    shimmer.start(now);

    this.voices.set(id, {
      gainNode: noteGain,
      oscillators: [fundamental, shimmer],
    });
  }

  stopNote(id: string) {
    if (!this.context) {
      return;
    }

    const voice = this.voices.get(id);
    if (!voice) {
      return;
    }

    const now = this.context.currentTime;
    voice.gainNode.gain.cancelScheduledValues(now);
    voice.gainNode.gain.setValueAtTime(Math.max(voice.gainNode.gain.value, 0.0001), now);
    voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    voice.oscillators.forEach((oscillator) => oscillator.stop(now + 0.26));

    window.setTimeout(() => {
      voice.oscillators.forEach((oscillator) => oscillator.disconnect());
      voice.gainNode.disconnect();
    }, 320);

    this.voices.delete(id);
  }

  stopAll() {
    Array.from(this.voices.keys()).forEach((id) => this.stopNote(id));
  }
}
