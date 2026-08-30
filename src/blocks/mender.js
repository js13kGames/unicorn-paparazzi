import { defineBlock } from './base.js';

export default defineBlock({
    code: 'GGB',
    name: 'Mender',
    desc: 'Slowly repairs damaged neighbours.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s / 2, 0);
        c.lineTo(s / 2, s);
        c.moveTo(0, s / 2);
        c.lineTo(s, s / 2);
        c.stroke();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
