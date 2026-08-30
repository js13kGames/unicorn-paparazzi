import { defineBlock } from './base.js';

export default defineBlock({
    code: 'GBB',
    name: 'Fin',
    desc: 'Directional movement, but only through a fluid.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s * 0.1, s);
        c.quadraticCurveTo(s * 0.1, 0, s * 0.9, s * 0.15);
        c.quadraticCurveTo(s * 0.5, s * 0.7, s * 0.1, s);
        c.stroke();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
