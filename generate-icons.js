const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

/**
 * Generates PWA icons: a short RGB codon strip on the game's dark background.
 */
function generateIcon(size, filename) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, size, size);

  // Three tiles stacked, one per base, matching the in-game pure codon colours.
  const colors = ['#ff0000', '#00ff00', '#0000ff'];
  const pad = size * 0.18;
  const gap = size * 0.04;
  const tile = (size - pad * 2 - gap * 2) / 3;

  colors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(pad, pad + i * (tile + gap), size - pad * 2, tile);
  });

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(__dirname, filename), buffer);
  console.log(`✓ Generated ${filename} (${size}x${size})`);
}

console.log('Generating PWA icons...');
generateIcon(192, 'icon-192.png');
generateIcon(512, 'icon-512.png');
console.log('✓ Icon generation complete!');
