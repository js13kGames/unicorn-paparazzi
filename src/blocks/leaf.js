import { defineBlock } from './base.js';

// GGG - pure green.
export default defineBlock({
    code: 'GGG',
    name: 'Leaf',
    desc: 'Harvests light. Yields most from light matching its own colour.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(0, s);
        c.quadraticCurveTo(0, 0, s, 0);
        c.quadraticCurveTo(s, s, 0, s);
        c.stroke();
        c.beginPath();
        c.moveTo(0, s);
        c.lineTo(s * 0.75, s * 0.25);
        c.stroke();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
