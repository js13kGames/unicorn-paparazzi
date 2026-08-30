import { defineBlock } from './base.js';

export default defineBlock({
    code: 'GRR',
    name: 'Piston',
    desc: 'Extends and retracts on a clock. Lets a body walk or wedge itself.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s / 2, 0);
        c.lineTo(s / 2, s * 0.6);
        c.stroke();
        c.strokeRect(s * 0.1, s * 0.6, s * 0.8, s * 0.4);
        c.beginPath();
        c.moveTo(s * 0.25, 0);
        c.lineTo(s * 0.75, 0);
        c.stroke();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
