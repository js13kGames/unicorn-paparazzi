import { defineBlock } from './base.js';

export default defineBlock({
    code: 'RGG',
    name: 'Gut',
    desc: 'Converts captured matter into stored energy.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s * 0.1, 0);
        c.quadraticCurveTo(s, s * 0.25, s * 0.1, s * 0.5);
        c.quadraticCurveTo(s * -0.2, s * 0.75, s * 0.9, s);
        c.stroke();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
