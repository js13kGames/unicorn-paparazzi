import { defineBlock } from './base.js';

// RRR - pure red. One of the three saturated "core organ" codons.
export default defineBlock({
    code: 'RRR',
    name: 'Reactor',
    desc: 'Burns stored energy in a burst. Drives adjacent blocks harder.',
    icon(c, s) {
        const m = s / 2;
        c.beginPath();
        c.arc(m, m, s * 0.16, 0, 7);
        c.fill();
        for (let i = 0; i < 3; i++) {
            c.save();
            c.translate(m, m);
            c.rotate((i * Math.PI) / 3);
            c.beginPath();
            c.ellipse(0, 0, m, s * 0.18, 0, 0, 7);
            c.stroke();
            c.restore();
        }
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
