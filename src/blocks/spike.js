import { defineBlock } from './base.js';

export default defineBlock({
    code: 'RRB',
    name: 'Spike',
    desc: 'Damages whatever it touches. Costs energy on contact.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s / 2, 0);
        c.lineTo(s * 0.85, s);
        c.lineTo(s * 0.15, s);
        c.closePath();
        c.fill();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
