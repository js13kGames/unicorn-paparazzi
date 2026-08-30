import { grow, bounds } from './grow.js';
import { drawBlock } from './blocks/base.js';

// An engine actor: holds a genome, grows it into a body, and draws it centred
// in the canvas. Abilities run through each block's onUpdate.
export class Organism {
    constructor(canvas, genome = '') {
        this.canvas = canvas;
        this.cellSize = 44;
        this.setGenome(genome);
    }

    setGenome(genome) {
        this.genome = genome;
        this.body = grow(genome);
        this.bounds = bounds(this.body);
        return this.body;
    }

    // Top-left canvas position of the body's bounding box.
    origin() {
        const s = this.cellSize;
        return {
            x: (this.canvas.width - this.bounds.width * s) / 2,
            y: (this.canvas.height - this.bounds.height * s) / 2,
        };
    }

    // Canvas position of a given block.
    blockRect(block) {
        const s = this.cellSize;
        const o = this.origin();
        return {
            x: o.x + (block.x - this.bounds.minX) * s,
            y: o.y + (block.y - this.bounds.minY) * s,
            size: s,
        };
    }

    // Which block, if any, is under a canvas-space point.
    blockAt(px, py) {
        for (const block of this.body.blocks) {
            const r = this.blockRect(block);
            if (px >= r.x && px < r.x + r.size && py >= r.y && py < r.y + r.size) {
                return block;
            }
        }
        return null;
    }

    update(dt) {
        for (const block of this.body.blocks) {
            block.def.onUpdate(dt, this, block);
        }
    }

    draw(ctx) {
        for (const block of this.body.blocks) {
            const r = this.blockRect(block);
            ctx.save();
            // A block's heading decides which way its icon points, so the same
            // block reached along a different path behaves - and reads - differently.
            ctx.translate(r.x + r.size / 2, r.y + r.size / 2);
            ctx.rotate((block.heading * Math.PI) / 2);
            ctx.translate(-r.size / 2, -r.size / 2);
            drawBlock(ctx, block.def, block.codon, 0, 0, r.size);
            ctx.restore();

            if (block === this.highlight) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.strokeRect(r.x + 1, r.y + 1, r.size - 2, r.size - 2);
            }
        }
    }
}
