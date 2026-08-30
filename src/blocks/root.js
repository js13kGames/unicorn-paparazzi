import { defineBlock } from './base.js';

export default defineBlock({
    code: 'GRG',
    name: 'Root',
    desc: 'Draws energy from the ground. Useless unless it reaches the floor.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s / 2, 0);
        c.lineTo(s / 2, s * 0.5);
        c.moveTo(s / 2, s * 0.5);
        c.lineTo(0, s);
        c.moveTo(s / 2, s * 0.5);
        c.lineTo(s / 2, s);
        c.moveTo(s / 2, s * 0.5);
        c.lineTo(s, s);
        c.stroke();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
