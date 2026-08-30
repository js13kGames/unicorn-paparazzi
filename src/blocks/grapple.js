import { defineBlock } from './base.js';

export default defineBlock({
    code: 'BRR',
    name: 'Grapple',
    desc: 'Anchors to terrain or to another organism.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s / 2, 0);
        c.lineTo(s / 2, s * 0.5);
        c.arc(s * 0.25, s * 0.5, s * 0.25, 0, Math.PI);
        c.stroke();
        c.beginPath();
        c.arc(s / 2, 0, s * 0.12, 0, 7);
        c.stroke();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
