import { defineBlock } from './base.js';

export default defineBlock({
    code: 'RRG',
    name: 'Thruster',
    desc: 'Pushes the body in the direction this cell faces.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s / 2, 0);
        c.lineTo(s, s * 0.55);
        c.lineTo(0, s * 0.55);
        c.closePath();
        c.stroke();
        for (let i = 0; i < 3; i++) {
            const x = s * (0.25 + i * 0.25);
            c.beginPath();
            c.moveTo(x, s * 0.7);
            c.lineTo(x, s);
            c.stroke();
        }
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
