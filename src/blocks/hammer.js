import { defineBlock } from './base.js';

export default defineBlock({
    code: 'RBR',
    name: 'Hammer',
    desc: 'Slow, heavy, and hits far harder than a Spike.',
    icon(c, s) {
        c.fillRect(s * 0.1, 0, s * 0.8, s * 0.3);
        c.beginPath();
        c.moveTo(s / 2, s * 0.3);
        c.lineTo(s / 2, s);
        c.stroke();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
