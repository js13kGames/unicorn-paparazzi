import { defineBlock } from './base.js';

export default defineBlock({
    code: 'RGR',
    name: 'Wheel',
    desc: 'Cheap movement, but only while touching the ground.',
    icon(c, s) {
        const m = s / 2;
        c.beginPath();
        c.arc(m, m, m, 0, 7);
        c.stroke();
        for (let i = 0; i < 3; i++) {
            const a = (i * Math.PI) / 3;
            c.beginPath();
            c.moveTo(m - Math.cos(a) * m, m - Math.sin(a) * m);
            c.lineTo(m + Math.cos(a) * m, m + Math.sin(a) * m);
            c.stroke();
        }
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
