(function () {
  // 1. Visitor Counter Helper
  async function updateVisitorBoxes() {
    const boxes = document.querySelectorAll('[data-visitor-box]');
    if (!boxes.length) return;
    const alreadyHit = sessionStorage.getItem('v_hit_done');
    const url = alreadyHit ? '/api/visitors' : '/api/visitors?hit=1';
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!alreadyHit) sessionStorage.setItem('v_hit_done', '1');
      const html = `
        <span class="v-item"><span class="status-dot online"></span> 현재 접속 <strong>${data.online}</strong>명</span>
        <span class="v-sep">·</span>
        <span class="v-item">오늘 방문 <strong>${data.today.toLocaleString()}</strong>명</span>
        <span class="v-sep">·</span>
        <span class="v-item">누적 방문 <strong>${data.total.toLocaleString()}</strong>명</span>
        <span class="v-sep">·</span>
        <span class="v-item">개설된 방 <strong>${data.activeRooms}</strong>개 <small>(최대 ${data.maxRooms}개 방 · 방당 100명)</small></span>
      `;
      boxes.forEach((el) => {
        el.innerHTML = html;
      });
    } catch (e) {
      // ignore
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateVisitorBoxes);
  } else {
    updateVisitorBoxes();
  }
  setInterval(updateVisitorBoxes, 15000);

  // 2. Three.js 3D Bouncing Ball & Particle Arena for Clicker Game
  let threeLoadPromise = null;
  function ensureThreeLoaded() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (threeLoadPromise) return threeLoadPromise;
    threeLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      s.onload = () => resolve(window.THREE);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return threeLoadPromise;
  }

  const PALETTE = [0xfde047, 0xff4d6d, 0x38bdf8, 0xa855f7, 0x10b981, 0xfb923c, 0x6366f1];

  window.createClicker3DArena = function (containerEl, opts = {}) {
    if (!containerEl) return { burst() {}, stop() {}, start() {} };

    let running = false;
    let rafId = null;
    let scene, camera, renderer;
    const balls = [];
    const sparks = [];
    let shakeIntensity = 0;
    const maxBalls = opts.maxBalls || 45;

    async function init() {
      const THREE = await ensureThreeLoaded();
      if (renderer) return;

      const width = containerEl.clientWidth || 320;
      const height = containerEl.clientHeight || 200;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 100);
      camera.position.set(0, 1.2, 8.2);
      camera.lookAt(0, -0.4, 0);

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      containerEl.innerHTML = '';
      containerEl.appendChild(renderer.domElement);

      // Lights
      const ambient = new THREE.AmbientLight(0xffffff, 0.65);
      scene.add(ambient);

      const point1 = new THREE.PointLight(0xfde047, 1.4, 25);
      point1.position.set(4, 6, 5);
      scene.add(point1);

      const point2 = new THREE.PointLight(0xff4d6d, 1.2, 25);
      point2.position.set(-4, -2, 4);
      scene.add(point2);

      // Neon Floor Grid
      const grid = new THREE.GridHelper(14, 14, 0x6366f1, 0x1e293b);
      grid.position.y = -2.4;
      scene.add(grid);

      // Spawn a few initial lively balls
      for (let i = 0; i < 6; i++) {
        spawnBall(THREE, false);
      }

      window.addEventListener('resize', () => {
        if (!renderer || !containerEl.clientWidth) return;
        const w = containerEl.clientWidth;
        const h = containerEl.clientHeight || 200;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });
    }

    function spawnBall(THREE, energetic = true) {
      if (!scene) return;
      const radius = 0.24 + Math.random() * 0.28;
      const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      const geom = new THREE.SphereGeometry(radius, 20, 20);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.35,
        roughness: 0.2,
        metalness: 0.3,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set((Math.random() - 0.5) * 3.2, -1.8 + Math.random() * 0.8, (Math.random() - 0.5) * 2);

      const vy = energetic ? 0.16 + Math.random() * 0.18 : 0.08 + Math.random() * 0.08;
      const vx = (Math.random() - 0.5) * (energetic ? 0.22 : 0.1);
      const vz = (Math.random() - 0.5) * 0.14;

      scene.add(mesh);
      balls.push({ mesh, radius, vx, vy, vz, life: 0 });

      while (balls.length > maxBalls) {
        const oldest = balls.shift();
        scene.remove(oldest.mesh);
        oldest.mesh.geometry.dispose();
        oldest.mesh.material.dispose();
      }
    }

    function spawnSparks(THREE, count = 8) {
      if (!scene) return;
      for (let i = 0; i < count; i++) {
        const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        const geom = new THREE.OctahedronGeometry(0.11, 0);
        const mat = new THREE.MeshBasicMaterial({ color });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set((Math.random() - 0.5) * 2.5, -0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5);
        scene.add(mesh);
        sparks.push({
          mesh,
          vx: (Math.random() - 0.5) * 0.28,
          vy: 0.1 + Math.random() * 0.22,
          vz: (Math.random() - 0.5) * 0.2,
          ttl: 28,
        });
      }
    }

    function animate() {
      if (!running) return;
      rafId = requestAnimationFrame(animate);
      if (!renderer || !scene || !camera) return;

      // Camera shake decay
      if (shakeIntensity > 0.002) {
        camera.position.x = (Math.random() - 0.5) * shakeIntensity;
        camera.position.y = 1.2 + (Math.random() - 0.5) * shakeIntensity;
        shakeIntensity *= 0.85;
      } else {
        camera.position.x = 0;
        camera.position.y = 1.2;
      }

      // Physics for bouncing balls
      const floorY = -2.4;
      for (const b of balls) {
        b.vy -= 0.0085; // gravity
        b.mesh.position.x += b.vx;
        b.mesh.position.y += b.vy;
        b.mesh.position.z += b.vz;
        b.mesh.rotation.x += 0.06;
        b.mesh.rotation.y += 0.08;

        // Bounce off floor
        if (b.mesh.position.y - b.radius < floorY) {
          b.mesh.position.y = floorY + b.radius;
          b.vy = Math.max(0.09, Math.abs(b.vy) * 0.84);
        }
        // Bounce off walls
        if (Math.abs(b.mesh.position.x) > 4.2) {
          b.vx *= -0.9;
          b.mesh.position.x = Math.sign(b.mesh.position.x) * 4.2;
        }
        if (Math.abs(b.mesh.position.z) > 2.2) {
          b.vz *= -0.9;
          b.mesh.position.z = Math.sign(b.mesh.position.z) * 2.2;
        }
      }

      // Sparks update
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.vy -= 0.006;
        sp.mesh.position.x += sp.vx;
        sp.mesh.position.y += sp.vy;
        sp.mesh.position.z += sp.vz;
        sp.mesh.rotation.z += 0.2;
        sp.mesh.scale.multiplyScalar(0.93);
        sp.ttl -= 1;
        if (sp.ttl <= 0) {
          scene.remove(sp.mesh);
          sp.mesh.geometry.dispose();
          sp.mesh.material.dispose();
          sparks.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
    }

    return {
      async start() {
        await init();
        if (!running) {
          running = true;
          animate();
        }
      },
      stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
      },
      async burst(intensity = 1) {
        const THREE = await ensureThreeLoaded();
        if (!running) await this.start();
        const ballCount = Math.min(4, Math.max(1, Math.ceil(intensity)));
        for (let i = 0; i < ballCount; i++) {
          spawnBall(THREE, true);
        }
        spawnSparks(THREE, 6);
        // Kick existing balls upward for extra spectacle!
        for (const b of balls) {
          if (Math.random() < 0.35) {
            b.vy = Math.max(b.vy, 0.12 + Math.random() * 0.14);
          }
        }
        shakeIntensity = Math.min(0.28, shakeIntensity + 0.09);
      },
    };
  };
})();
