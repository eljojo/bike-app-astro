interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
}

const COLORS = ['#ff9500', '#350091', '#4a9eff', '#34c759', '#ff6b6b', '#ffd60a'];
const PARTICLE_COUNT = 80;
const GRAVITY = 0.12;
const FADE_RATE = 0.005;

export function launchConfetti(container: HTMLElement): void {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * 200,
    y: canvas.height * 0.4,
    vx: (Math.random() - 0.5) * 12,
    vy: -Math.random() * 14 - 4,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: Math.random() * 8 + 4,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.2,
    opacity: 1,
  }));

  let animationId: number;
  function animate() {
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      if (p.opacity <= 0) continue;
      alive = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += GRAVITY;
      p.vx *= 0.99;
      p.rotation += p.rotationSpeed;
      p.opacity -= FADE_RATE;

      ctx!.save();
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.rotation);
      ctx!.globalAlpha = Math.max(0, p.opacity);
      ctx!.fillStyle = p.color;
      ctx!.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx!.restore();
    }
    if (alive) { animationId = requestAnimationFrame(animate); }
    else { canvas.remove(); }
  }
  animationId = requestAnimationFrame(animate);

  // Safety cleanup after 5 seconds
  setTimeout(() => { cancelAnimationFrame(animationId); canvas.remove(); }, 5000);
}
