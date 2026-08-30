import { codonColor } from '../genome.js';

// Every block file default-exports an object of this shape. defineBlock only
// fills in the parts a block chooses not to specify.
//
//   code     the codon that expresses this block, e.g. 'RRR'
//   name     display name
//   desc     one line shown in the inspector
//   icon     icon(ctx, s) draws into a 0..s box. Stroke and fill are already
//            set to the icon colour and the path is already translated, so a
//            block only describes its shape.
//   onUpdate onUpdate(dt, organism, cell) - the block's per-frame ability
//
export function defineBlock(def) {
    return {
        desc: '',
        icon() { },
        onUpdate() { },
        ...def,
    };
}

// Shared look for every block, so no individual block file decides how a block
// is framed. Draws the codon-coloured tile, then hands the icon a clean box.
export function drawBlock(ctx, def, codon, x, y, size) {
    const inset = size * 0.06;
    const s = size - inset * 2;

    ctx.save();
    ctx.translate(x + inset, y + inset);

    ctx.fillStyle = codonColor(codon);
    ctx.fillRect(0, 0, s, s);

    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(1, size * 0.04);
    ctx.strokeRect(0, 0, s, s);

    // Icons draw in the middle 60% of the tile, in white.
    const pad = s * 0.2;
    ctx.translate(pad, pad);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = Math.max(1, s * 0.075);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    def.icon(ctx, s - pad * 2);

    ctx.restore();
}
