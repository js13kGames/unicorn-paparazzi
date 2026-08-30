import { defineBlock } from './base.js';

export default defineBlock({
    code: 'BGB',
    name: 'Shield',
    desc: 'Soaks damage aimed at its neighbours. Heavy.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s / 2, 0);
        c.lineTo(s, s * 0.22);
        c.quadraticCurveTo(s, s * 0.8, s / 2, s);
        c.quadraticCurveTo(0, s * 0.8, 0, s * 0.22);
        c.closePath();
        c.stroke();
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
