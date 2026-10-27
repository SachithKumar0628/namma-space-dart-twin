import * as THREE from 'three';

/**
 * proceduralArchitecturalTextures.ts
 * Generates photorealistic architectural textures dynamically via HTML5 Canvas
 * for floors, walls, granite counters, timber slats, and baseboards.
 * Zero external asset dependencies; instant load, fully repeatable, high resolution.
 */

// Texture cache to prevent redundant canvas redraws
const textureCache = new Map<string, THREE.CanvasTexture>();

/**
 * 1. Warm Natural European Oak Parquet / Hardwood Planks
 */
export function getWoodParquetTexture(): THREE.CanvasTexture {
  const cacheKey = 'wood_parquet';
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey)!;

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Base warm honey/oak tone
  ctx.fillStyle = '#a87346';
  ctx.fillRect(0, 0, 1024, 1024);

  const plankHeight = 64; // 16 planks
  const plankLengths = [256, 384, 512, 320, 448];

  const plankTones = [
    '#9e673a',
    '#ad7748',
    '#b47e4f',
    '#975f32',
    '#aa7243',
    '#a26b3c',
    '#b88253',
  ];

  // Draw staggered wood planks
  for (let y = 0; y < 1024; y += plankHeight) {
    let x = (y * 137) % 256 - 256;
    let plankIdx = Math.floor(y / plankHeight);

    while (x < 1024) {
      const len = plankLengths[(plankIdx + Math.floor(x / 200)) % plankLengths.length];
      const tone = plankTones[(plankIdx * 3 + Math.floor(x / 150)) % plankTones.length];

      ctx.fillStyle = tone;
      ctx.fillRect(x + 1, y + 1, len - 2, plankHeight - 2);

      // Fine woodgrain noise streaks
      ctx.strokeStyle = 'rgba(70, 40, 15, 0.12)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 4; g++) {
        const gy = y + 8 + g * 13;
        ctx.beginPath();
        ctx.moveTo(x + 2, gy);
        ctx.bezierCurveTo(
          x + len * 0.3,
          gy + ((g % 2 === 0 ? 1 : -1) * 3),
          x + len * 0.7,
          gy - ((g % 2 === 0 ? 1 : -1) * 2),
          x + len - 2,
          gy
        );
        ctx.stroke();
      }

      // Micro-bevel shadow on bottom & right edges
      ctx.fillStyle = 'rgba(40, 20, 8, 0.28)';
      ctx.fillRect(x, y + plankHeight - 1, len, 1);
      ctx.fillRect(x + len - 1, y, 1, plankHeight);

      // Subtle light bevel highlight on top edge
      ctx.fillStyle = 'rgba(255, 230, 200, 0.18)';
      ctx.fillRect(x + 1, y + 1, len - 2, 1);

      x += len;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * 2. Polished Italian Porcelain / Calacatta Marble Tiles
 */
export function getMarbleTileTexture(): THREE.CanvasTexture {
  const cacheKey = 'marble_tile';
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey)!;

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Base off-white polished porcelain
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 1024, 1024);

  const tileSize = 256; // 4x4 grid of 60x60cm tiles

  for (let ty = 0; ty < 1024; ty += tileSize) {
    for (let tx = 0; tx < 1024; tx += tileSize) {
      // Tile face subtle variation
      const tileTone = (tx + ty) % 512 === 0 ? '#f1f5f9' : '#f8fafc';
      ctx.fillStyle = tileTone;
      ctx.fillRect(tx + 2, ty + 2, tileSize - 4, tileSize - 4);

      // Elegant marble veins
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const vx = tx + 30 + ((tx * 17) % 60);
      const vy = ty + 20;
      ctx.moveTo(vx, vy);
      ctx.bezierCurveTo(
        vx + 60,
        vy + 80,
        vx - 30,
        vy + 160,
        vx + 90,
        vy + tileSize - 30
      );
      ctx.stroke();

      // Delicate secondary vein
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx + 120, ty + 40);
      ctx.quadraticCurveTo(tx + 180, ty + 120, tx + 140, ty + 220);
      ctx.stroke();

      // Crisp tile grout lines (2mm grout)
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3;
      ctx.strokeRect(tx + 1.5, ty + 1.5, tileSize - 3, tileSize - 3);

      // Soft perimeter bevel inside grout
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx + 3, ty + 3, tileSize - 6, tileSize - 6);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * 3. Kitchen Black Galaxy Polished Granite
 */
export function getKitchenGraniteTexture(): THREE.CanvasTexture {
  const cacheKey = 'kitchen_granite';
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey)!;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Deep obsidian/charcoal base
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, 512, 512);

  // Granite crystalline flecks
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = Math.random() * 1.8 + 0.4;
    const rand = Math.random();

    if (rand > 0.85) {
      // Quartz/mica gold flecks
      ctx.fillStyle = 'rgba(217, 119, 6, 0.65)';
    } else if (rand > 0.6) {
      // Silver sparkles
      ctx.fillStyle = 'rgba(226, 232, 240, 0.7)';
    } else {
      // Dark grey crystalline mineral
      ctx.fillStyle = 'rgba(63, 63, 70, 0.8)';
    }
    ctx.fillRect(x, y, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * 4. Exterior Teak Balcony Decking Planks
 */
export function getBalconyDeckTexture(): THREE.CanvasTexture {
  const cacheKey = 'balcony_deck';
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey)!;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Drainage sub-gap black
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, 512, 512);

  const slatHeight = 42;
  const tones = ['#92400e', '#78350f', '#a16207', '#854d0e', '#713f12'];

  for (let y = 0; y < 512; y += slatHeight) {
    const tone = tones[Math.floor(y / slatHeight) % tones.length];
    ctx.fillStyle = tone;
    // Slat with 3px drainage gap
    ctx.fillRect(0, y + 2, 512, slatHeight - 4);

    // Slat woodgrain
    ctx.strokeStyle = 'rgba(67, 20, 7, 0.2)';
    ctx.lineWidth = 1;
    for (let s = 0; s < 3; s++) {
      const sy = y + 8 + s * 10;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(512, sy + (s % 2 === 0 ? 1 : -1) * 2);
      ctx.stroke();
    }

    // Screw / fastener head indents
    ctx.fillStyle = 'rgba(120, 113, 108, 0.7)';
    for (let fx = 48; fx < 512; fx += 160) {
      ctx.beginPath();
      ctx.arc(fx, y + slatHeight / 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * 5. Architectural Wall Stipple & Plaster Texture
 */
export function getPlasterWallTexture(baseHex: string = '#f1f5f9'): THREE.CanvasTexture {
  const cacheKey = `plaster_${baseHex}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey)!;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 512, 512);

  // Micro-stipple drywall texture
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const opacity = Math.random() * 0.06;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255, 255, 255, ${opacity})` : `rgba(0, 0, 0, ${opacity * 0.7})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * 6. Vertical Acoustic Timber Slat Media Wall Texture
 */
export function getTimberSlatTexture(): THREE.CanvasTexture {
  const cacheKey = 'timber_slat';
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey)!;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Acoustic black felt backing
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 512, 512);

  const slatWidth = 16;
  const gap = 8;
  const total = slatWidth + gap;

  for (let x = 0; x < 512; x += total) {
    // Walnut timber slat
    ctx.fillStyle = '#5c3a21';
    ctx.fillRect(x, 0, slatWidth, 512);

    // Edge bevel highlight
    ctx.fillStyle = 'rgba(215, 150, 95, 0.35)';
    ctx.fillRect(x, 0, 2, 512);

    // Edge shadow
    ctx.fillStyle = 'rgba(30, 15, 5, 0.45)';
    ctx.fillRect(x + slatWidth - 2, 0, 2, 512);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(cacheKey, texture);
  return texture;
}
