// The six grey codons - the ones holding one of each base. They have no colour,
// so they express no block; they steer the read head instead.
export const CONTROL = {
    RGB: { op: 'STOP', name: 'Stop', desc: 'Ends this branch.' },
    RBG: { op: 'PUSH', name: 'Branch', desc: 'Saves the position and heading, starting a side branch.' },
    GRB: { op: 'POP', name: 'Return', desc: 'Returns to the last Branch.' },
    GBR: { op: 'LEFT', name: 'Turn left', desc: 'Rotates the read head a quarter turn anticlockwise.' },
    BRG: { op: 'RIGHT', name: 'Turn right', desc: 'Rotates the read head a quarter turn clockwise.' },
    BGR: { op: 'NOP', name: 'Silent', desc: 'Does nothing. Keeps frameshifted genomes readable.' },
};

export function controlFor(codon) {
    return CONTROL[codon];
}
