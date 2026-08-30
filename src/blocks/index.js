import reactor from './reactor.js';
import leaf from './leaf.js';
import brain from './brain.js';
import thruster from './thruster.js';
import wheel from './wheel.js';
import piston from './piston.js';
import spike from './spike.js';
import hammer from './hammer.js';
import grapple from './grapple.js';
import seed from './seed.js';
import root from './root.js';
import gut from './gut.js';
import mender from './mender.js';
import sac from './sac.js';
import spore from './spore.js';
import prism from './prism.js';
import antenna from './antenna.js';
import horn from './horn.js';
import eye from './eye.js';
import shield from './shield.js';
import fin from './fin.js';

// The 21 codons that are not grey. Each block declares which codon expresses
// it, so this list is the only place that has to stay in sync.
const ALL = [
    reactor, leaf, brain,
    thruster, wheel, piston,
    spike, hammer, grapple,
    seed, root, gut,
    mender, sac, spore,
    prism, antenna, horn,
    eye, shield, fin,
];

export const BLOCKS = {};
for (const def of ALL) {
    BLOCKS[def.code] = def;
}

export function blockFor(codon) {
    return BLOCKS[codon];
}
