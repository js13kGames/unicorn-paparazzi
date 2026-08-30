import { defineBlock } from './base.js';

export default defineBlock({
    code: 'GGR',
    name: 'Seed',
    desc: 'Copies the genome, with mutations, once enough energy is stored.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s / 2, 0);
        c.quadraticCurveTo(s, s * 0.4, s / 2, s);
        c.quadraticCurveTo(0, s * 0.4, s / 2, 0);
        c.stroke();
        c.beginPath();
        c.arc(s / 2, s * 0.6, s * 0.12, 0, 7);
        c.fill();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
