import { defineBlock } from './base.js';

export default defineBlock({
    code: 'BBR',
    name: 'Prism',
    desc: 'Splits white light into R, G and B beams for colour-tuned neighbours.',
    icon(c, s) {
        c.beginPath();
        c.moveTo(s / 2, s * 0.1);
        c.lineTo(s * 0.9, s * 0.85);
        c.lineTo(s * 0.1, s * 0.85);
        c.closePath();
        c.stroke();
        c.beginPath();
        c.moveTo(0, s * 0.45);
        c.lineTo(s / 2, s * 0.55);
        c.stroke();
        for (let i = 0; i < 3; i++) {
            c.beginPath();
            c.moveTo(s / 2, s * 0.55);
            c.lineTo(s, s * (0.35 + i * 0.22));
            c.stroke();
        }
    },
    onUpdate(dt, organism, cell) {
        // TODO: ability
    },
});
