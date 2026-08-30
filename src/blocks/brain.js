import { defineBlock } from './base.js';

// BBB - pure blue.
export default defineBlock({
    code: 'BBB',
    name: 'Brain',
    desc: 'Gates its neighbours: they act only while the Brain is signalled.',
    icon(c, s) {
        c.beginPath();
        c.arc(s / 2, s / 2, s * 0.45, 0, 7);
        c.stroke();
        c.beginPath();
        c.moveTo(s * 0.2, s * 0.6);
        c.quadraticCurveTo(s * 0.4, s * 0.2, s * 0.55, s * 0.5);
        c.quadraticCurveTo(s * 0.7, s * 0.8, s * 0.82, s * 0.42);
        c.stroke();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
