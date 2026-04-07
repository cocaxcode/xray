const MAX_DT = 0.1; // Clamp delta time to 100ms (prevents huge jumps after tab unfocus)

export interface GameLoop {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
}

export function createGameLoop(
  canvas: HTMLCanvasElement,
  updateFn: (dt: number) => void,
  renderFn: (ctx: CanvasRenderingContext2D) => void,
): GameLoop {
  let animFrameId: number | null = null;
  let lastTime = 0;
  let running = false;

  const ctx = canvas.getContext('2d')!;

  // Pixel-perfect rendering for sprites
  ctx.imageSmoothingEnabled = false;

  // Handle high-DPI displays
  function setupCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
  }

  // ResizeObserver for responsive canvas
  const resizeObserver = new ResizeObserver(() => {
    if (running) setupCanvas();
  });

  function tick(time: number): void {
    if (!running) return;

    const dt = Math.min((time - lastTime) / 1000, MAX_DT);
    lastTime = time;

    updateFn(dt);

    // Reset transform before rendering (scale was set in setupCanvas)
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    renderFn(ctx);

    animFrameId = requestAnimationFrame(tick);
  }

  function start(): void {
    if (running) return;
    running = true;
    setupCanvas();
    resizeObserver.observe(canvas.parentElement || canvas);
    lastTime = performance.now();
    animFrameId = requestAnimationFrame(tick);
  }

  function stop(): void {
    running = false;
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    resizeObserver.disconnect();
  }

  function isRunning(): boolean {
    return running;
  }

  return { start, stop, isRunning };
}
