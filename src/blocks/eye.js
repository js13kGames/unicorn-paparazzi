import { defineBlock } from './base.js';

export default defineBlock({
    code: 'BBG',
    name: 'Eye',
    desc: 'Signals when it sees light or another organism ahead of it.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(0, s / 2);
        c.quadraticCurveTo(s / 2, 0, s, s / 2);
        c.quadraticCurveTo(s / 2, s, 0, s / 2);
        c.stroke();
        c.beginPath();
        c.arc(s / 2, s / 2, s * 0.16, 0, 7);
        c.fill();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
