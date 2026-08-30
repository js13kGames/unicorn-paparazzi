import { defineBlock } from './base.js';

export default defineBlock({
    code: 'GBG',
    name: 'Sac',
    desc: 'Stores energy. Without one, shade is fatal immediately.',
    icon(c, s) {
        c.beginPath();
        c.arc(s / 2, s * 0.62, s * 0.38, 0, 7);
        c.stroke();
        c.beginPath();
        c.moveTo(s * 0.38, s * 0.24);
        c.lineTo(s * 0.62, s * 0.24);
        c.stroke();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
