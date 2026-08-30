export const BASES = 'RGB';
export const CODON_LENGTH = 3;

// How many of a letter a codon holds -> that channel's intensity.
const CHANNEL = [0, 64, 128, 255];

// [r, g, b] for a codon, from its letter counts alone. RRR -> 255,0,0.
// RBB -> 64,0,128. RBG -> 64,64,64 (and so does every other codon holding one
// of each letter, which is what makes those six usable as control ops).
export function codonRgb(codon) {
    const counts = [0, 0, 0];
    for (const base of codon) {
        const i = BASES.indexOf(base);
        if (i !== -1) {
            counts[i]++;
        }
    }
    return counts.map(c => CHANNEL[c]);
}

export function codonColor(codon) {
    return `rgb(${codonRgb(codon).join(',')})`;
}

// True when a codon holds one of each base, i.e. it is grey, i.e. it codes for
// a control op rather than a block.
export function isControl(codon) {
    return codon.length === CODON_LENGTH
        && codon.includes('R') && codon.includes('G') && codon.includes('B');
}

// Split into whole codons. A trailing 1-2 bases are not readable and dropped.
export function codons(genome) {
    const out = [];
    for (let i = 0; i + CODON_LENGTH <= genome.length; i += CODON_LENGTH) {
        out.push(genome.substr(i, CODON_LENGTH));
    }
    return out;
}

// Strip anything that isn't a base, so the genome field can be typed into freely.
export function sanitize(text) {
    return text.toUpperCase().replace(/[^RGB]/g, '');
}

function randomBase() {
    return BASES[Math.floor(Math.random() * BASES.length)];
}

export function randomGenome(codonCount = 12) {
    let out = '';
    for (let i = 0; i < codonCount * CODON_LENGTH; i++) {
        out += randomBase();
    }
    return out;
}

// Per-base mutation. Substitutions keep the reading frame; insertions and
// deletions shift it, so every codon downstream is re-read as something else.
export function mutate(genome, rate = 0.02) {
    let out = '';
    for (const base of genome) {
        if (Math.random() < rate) {
            const roll = Math.random();
            if (roll < 0.6) {
                out += randomBase();          // substitution
            } else if (roll < 0.8) {
                out += base + randomBase();   // insertion (frameshift)
            }
            // else: deletion (frameshift) - emit nothing
        } else {
            out += base;
        }
    }
    return out;
}

// Single-point crossover on a codon boundary, so both halves stay in frame.
export function crossover(a, b) {
    const aCodons = codons(a);
    const bCodons = codons(b);
    if (!aCodons.length) return b;
    if (!bCodons.length) return a;

    const aCut = Math.floor(Math.random() * (aCodons.length + 1));
    const bCut = Math.floor(Math.random() * (bCodons.length + 1));
    return aCodons.slice(0, aCut).join('') + bCodons.slice(bCut).join('');
}

export function breed(a, b, rate = 0.02) {
    return mutate(crossover(a, b), rate);
}
