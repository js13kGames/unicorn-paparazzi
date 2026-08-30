import { defineBlock } from './base.js';

export default defineBlock({
    code: 'BRB',
    name: 'Antenna',
    desc: 'Receives signals from other organisms.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s / 2, s);
        c.lineTo(s / 2, s * 0.35);
        c.stroke();
        for (let i = 1; i < 3; i++) {
            c.beginPath();
            c.arc(s / 2, s * 0.35, s * 0.22 * i, -2.4, -0.75);
            c.stroke();
        }
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
