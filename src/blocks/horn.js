import { defineBlock } from './base.js';

// The trophy block. Deliberately expensive and useless on its own.
export default defineBlock({
    code: 'RBB',
    name: 'Horn',
    desc: 'Costly, and does nothing by itself. The mark of a unicorn.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s * 0.3, s);
        c.lineTo(s / 2, 0);
        c.lineTo(s * 0.7, s);
        c.closePath();
        c.stroke();
        for (let i = 1; i < 4; i++) {
            const y = (s * i) / 4;
            const half = (s * 0.2 * (s - y)) / s;
            c.beginPath();
            c.moveTo(s / 2 - half, y + s * 0.06);
            c.lineTo(s / 2 + half, y - s * 0.06);
            c.stroke();
        }
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
