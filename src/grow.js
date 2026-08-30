import { codons, isControl } from './genome.js';
import { blockFor } from './blocks/index.js';
import { controlFor } from './control.js';

// Headings, clockwise from up. Screen coordinates, so +y is down.
export const HEADINGS = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
];

// Guards against a genome that would grow forever or choke a frame.
const MAX_BLOCKS = 64;
const MAX_STEPS = 512;

const key = (x, y) => x + ',' + y;

// Reads a genome and returns the body it grows.
//
// A read head starts at 0,0 facing up with an empty stack. A functional codon
// places its block in the current cell and steps forward; a grey codon steers
// the head instead. Walking into an occupied cell kills the current branch,
// which is what stops a genome from overwriting its own body.
export function grow(genome) {
    const list = codons(genome);
    const occupied = new Map();
    const blocks = [];
    const stack = [];

    // The read head is an anchor - the cell of the last block placed - plus a
    // heading. A block is always laid down in the cell next to the anchor, so a
    // turn pivots around the last block and takes effect immediately. That is
    // what lets a branch leave the trunk in a different direction instead of
    // fighting it for the same cell.
    let ax = 0;
    let ay = 0;
    let heading = 0;
    let first = true;
    let i = 0;
    let steps = 0;
    let unexpressed = 0;
    let halted = false;

    // Ends the current branch: resume at the last Branch point, or stop.
    const endBranch = () => {
        if (stack.length) {
            ({ ax, ay, heading, first } = stack.pop());
        } else {
            halted = true;
        }
    };

    while (i < list.length && !halted && steps < MAX_STEPS) {
        const codon = list[i++];
        steps++;

        if (isControl(codon)) {
            const op = controlFor(codon).op;
            if (op === 'STOP' || op === 'POP') {
                endBranch();
            } else if (op === 'PUSH') {
                stack.push({ ax, ay, heading, first });
            } else if (op === 'LEFT') {
                heading = (heading + 3) % 4;
            } else if (op === 'RIGHT') {
                heading = (heading + 1) % 4;
            }
            // NOP falls through
            continue;
        }

        const step = HEADINGS[heading];
        const x = first ? 0 : ax + step.x;
        const y = first ? 0 : ay + step.y;

        if (occupied.has(key(x, y)) || blocks.length >= MAX_BLOCKS) {
            // Nowhere to put it. The codon is read but expresses nothing.
            unexpressed++;
            endBranch();
            continue;
        }

        const block = { codon, def: blockFor(codon), x, y, heading };
        occupied.set(key(x, y), block);
        blocks.push(block);
        ax = x;
        ay = y;
        first = false;
    }

    // Codons the read head never reached, because a branch died first.
    unexpressed += list.length - i;

    return {
        genome,
        blocks,
        occupied,
        codonsRead: i,
        codonsTotal: list.length,
        unexpressed,
    };
}

// Smallest grid rectangle containing the body.
export function bounds(body) {
    if (!body.blocks.length) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 1, height: 1 };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of body.blocks) {
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x > maxX) maxX = b.x;
        if (b.y > maxY) maxY = b.y;
    }
    return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
