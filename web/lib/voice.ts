/** Microphone capture for voice tutoring. Records one spoken question and stops by itself once the
 *  student stops talking (simple energy-based voice activity detection), so hands-free mode needs no taps. */

export type Capture = { stop: () => void; done: Promise<Blob | null> };

const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export function canRecord() {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export function recordUtterance({ maxMs = 30000, silenceMs = 1300, waitMs = 8000, onLevel }: { maxMs?: number; silenceMs?: number; waitMs?: number; onLevel?: (v: number) => void } = {}): Capture {
  let cancelled = false;
  let stopFn = () => {
    cancelled = true;
  };
  const done = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }
    const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new Ctx();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);

    let heard = false;
    let floor = 0.01;
    let loudFor = 0;
    let quietFor = 0;
    const t0 = performance.now();
    const STEP = 60;

    return await new Promise<Blob | null>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        if (rec.state !== "inactive") rec.stop();
        else settle();
      };
      const settle = () => {
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        resolve(heard && chunks.length ? new Blob(chunks, { type: rec.mimeType || "audio/webm" }) : null);
      };
      rec.onstop = settle;
      stopFn = finish;
      const timer = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const t = performance.now() - t0;
        if (t < 300) floor = Math.max(floor, rms); // room noise while the mic settles
        const thr = Math.max(0.018, floor * 2.2);
        onLevel?.(Math.min(1, rms / (thr * 3)));
        if (rms > thr) {
          loudFor += STEP;
          quietFor = 0;
          if (loudFor >= 180) heard = true;
        } else {
          loudFor = 0;
          quietFor += STEP;
        }
        if ((heard && quietFor >= silenceMs) || (!heard && t > waitMs) || t > maxMs) finish();
      }, STEP);
      rec.start(250);
    });
  })();
  return { stop: () => stopFn(), done };
}
