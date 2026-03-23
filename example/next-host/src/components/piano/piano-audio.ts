"use client";

type Voice = {
  gainNode: GainNode;
  nodes: AudioNode[]; // all nodes to disconnect on stop
};

export class PianoAudio {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private voices = new Map<string, Voice>();

  // Modulation (pitch vibrato via LFO)
  private modLfo: OscillatorNode | null = null;
  private modGain: GainNode | null = null;
  private _modRate = 0;
  private _modDepth = 0;

  // Tremolo (amplitude LFO)
  private tremLfo: OscillatorNode | null = null;
  private tremGain: GainNode | null = null;
  private _tremRate = 0;
  private _tremDepth = 0;

  private createReverbIR(ctx: AudioContext): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = rate * 2.2; // 2.2s reverb tail
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        // Exponential decay with slight randomness for natural feel
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.8);
      }
    }
    return buffer;
  }

  private async ensureContext() {
    if (!this.context) {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("This browser does not support Web Audio.");
      }

      this.context = new AudioContextCtor();

      // Master output
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.7;

      // Reverb send (wet)
      this.convolver = this.context.createConvolver();
      this.convolver.buffer = this.createReverbIR(this.context);
      const reverbGain = this.context.createGain();
      reverbGain.gain.value = 0.25; // wet amount
      this.convolver.connect(reverbGain);
      reverbGain.connect(this.context.destination);

      // Dry path
      const dryGain = this.context.createGain();
      dryGain.gain.value = 0.8;
      this.masterGain.connect(dryGain);
      dryGain.connect(this.context.destination);

      // Reverb send from master
      this.masterGain.connect(this.convolver);

      // Tremolo LFO → masterGain.gain
      this.tremLfo = this.context.createOscillator();
      this.tremLfo.type = "sine";
      this.tremLfo.frequency.value = this._tremRate;
      this.tremGain = this.context.createGain();
      this.tremGain.gain.value = 0;
      this.tremLfo.connect(this.tremGain);
      this.tremGain.connect(this.masterGain.gain);
      this.tremLfo.start();

      // Modulation LFO (connected per-voice to oscillator.frequency)
      this.modLfo = this.context.createOscillator();
      this.modLfo.type = "sine";
      this.modLfo.frequency.value = this._modRate;
      this.modGain = this.context.createGain();
      this.modGain.gain.value = 0;
      this.modLfo.connect(this.modGain);
      this.modLfo.start();
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    return this.context;
  }

  setModulation(rate: number, depth: number) {
    this._modRate = rate;
    this._modDepth = depth;
    if (this.modLfo) this.modLfo.frequency.value = rate;
    if (this.modGain) this.modGain.gain.value = depth * 4;
  }

  setTremolo(rate: number, depth: number) {
    this._tremRate = rate;
    this._tremDepth = depth;
    if (this.tremLfo) this.tremLfo.frequency.value = rate;
    if (this.tremGain) this.tremGain.gain.value = depth * 0.4;
  }

  get modRate() { return this._modRate; }
  get modDepth() { return this._modDepth; }
  get tremRate() { return this._tremRate; }
  get tremDepth() { return this._tremDepth; }

  async playNote(id: string, frequency: number) {
    const context = await this.ensureContext();
    if (!this.masterGain) return;
    if (this.voices.has(id)) return;

    const now = context.currentTime;
    const allNodes: AudioNode[] = [];

    // Per-voice gain with piano-like ADSR
    const noteGain = context.createGain();
    noteGain.gain.setValueAtTime(0.0001, now);
    noteGain.gain.exponentialRampToValueAtTime(0.18, now + 0.008); // fast attack
    noteGain.gain.exponentialRampToValueAtTime(0.10, now + 0.3);   // decay to sustain
    noteGain.connect(this.masterGain);
    allNodes.push(noteGain);

    // --- Richer oscillator stack for a warm piano-like tone ---

    // 1) Fundamental — sine for warmth
    const fundamental = context.createOscillator();
    fundamental.type = "sine";
    fundamental.frequency.setValueAtTime(frequency, now);
    allNodes.push(fundamental);

    // 2) Soft triangle one octave below (body/warmth, subtle)
    const sub = context.createOscillator();
    sub.type = "triangle";
    sub.frequency.setValueAtTime(frequency / 2, now);
    const subGain = context.createGain();
    subGain.gain.value = 0.12; // very subtle sub
    sub.connect(subGain);
    allNodes.push(sub, subGain);

    // 3) Soft 2nd harmonic (octave above) for brightness
    const harmonic2 = context.createOscillator();
    harmonic2.type = "sine";
    harmonic2.frequency.setValueAtTime(frequency * 2, now);
    const h2Gain = context.createGain();
    h2Gain.gain.value = 0.06;
    harmonic2.connect(h2Gain);
    allNodes.push(harmonic2, h2Gain);

    // 4) Very soft 3rd harmonic for sparkle
    const harmonic3 = context.createOscillator();
    harmonic3.type = "sine";
    harmonic3.frequency.setValueAtTime(frequency * 3, now);
    const h3Gain = context.createGain();
    h3Gain.gain.setValueAtTime(0.03, now);
    h3Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6); // sparkle fades fast
    harmonic3.connect(h3Gain);
    allNodes.push(harmonic3, h3Gain);

    // Modulation LFO connection
    if (this.modGain) {
      this.modGain.connect(fundamental.frequency);
      this.modGain.connect(harmonic2.frequency);
    }

    // Lowpass filter — frequency-dependent: higher notes get brighter cutoff
    const lpf = context.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.setValueAtTime(Math.min(frequency * 6, 8000), now);
    lpf.Q.value = 0.7;
    allNodes.push(lpf);

    // Connect oscillator stack → filter → noteGain
    fundamental.connect(lpf);
    subGain.connect(lpf);
    h2Gain.connect(lpf);
    h3Gain.connect(lpf);
    lpf.connect(noteGain);

    // Start all oscillators
    fundamental.start(now);
    sub.start(now);
    harmonic2.start(now);
    harmonic3.start(now);

    this.voices.set(id, { gainNode: noteGain, nodes: allNodes });
  }

  stopNote(id: string) {
    if (!this.context) return;
    const voice = this.voices.get(id);
    if (!voice) return;

    const now = this.context.currentTime;
    const releaseTime = 0.6; // longer release for piano feel

    voice.gainNode.gain.cancelScheduledValues(now);
    voice.gainNode.gain.setValueAtTime(Math.max(voice.gainNode.gain.value, 0.0001), now);
    voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

    // Stop oscillators after release
    for (const node of voice.nodes) {
      if (node instanceof OscillatorNode) {
        node.stop(now + releaseTime + 0.05);
      }
    }

    window.setTimeout(() => {
      for (const node of voice.nodes) node.disconnect();
    }, (releaseTime + 0.1) * 1000);

    this.voices.delete(id);
  }

  stopAll() {
    Array.from(this.voices.keys()).forEach((id) => this.stopNote(id));
  }
}
