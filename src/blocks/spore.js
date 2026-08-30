import { defineBlock } from './base.js';

export default defineBlock({
    code: 'BGG',
    name: 'Spore',
    desc: 'Cheap long-range reproduction, but loses a chunk of the genome.',
    icon(c, s) {
        c.beginPath();
        c.arc(s / 2, s / 2, s * 0.22, 0, 7);
        c.stroke();
        for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2 + 0.6;
            c.beginPath();
            c.arc(s / 2 + Math.cos(a) * s * 0.42, s / 2 + Math.sin(a) * s * 0.42, s * 0.08, 0, 7);
            c.fill();
        }
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
