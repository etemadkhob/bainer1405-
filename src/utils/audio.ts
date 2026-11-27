let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {
      // Ignore autoplay lock before user gesture
    });
  }
  return sharedAudioCtx;
}

export function unlockAudioContext(): void {
  getAudioContext();
}

export function playSignalChime(direction: 'CALL' | 'PUT'): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes =
      direction === 'CALL'
        ? [523.25, 659.25, 783.99] // C5 -> E5 -> G5 ascending crisp harmonic
        : [587.33, 493.88, 392.0]; // D5 -> B4 -> G4 descending crisp harmonic

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.085;
      const duration = 0.24;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.11, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  } catch {
    // Gracefully ignore audio errors in restricted environments
  }
}

/**
 * زنگ ملایمِ یادآور استراحت/بازبینی — کاملاً متمایز از چایم سیگنال:
 * دو نُت آرامِ C6 → G5 با گین کمتر تا با صدای CALL/PUT اشتباه نشود.
 */
export function playReminderChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [1046.5, 783.99]; // C6 -> G5 soft two-tone

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.22;
      const duration = 0.5;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration + 0.05);
    });
  } catch {
    // Gracefully ignore audio errors in restricted environments
  }
}
