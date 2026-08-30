import { sanitize, codons, codonColor, codonRgb, isControl, randomGenome, mutate, breed, BASES } from './genome.js';
import { blockFor } from './blocks/index.js';
import { controlFor } from './control.js';

const $ = id => document.getElementById(id);

// Names a codon whether it codes for a block or a control op.
function describe(codon) {
    if (isControl(codon)) {
        const c = controlFor(codon);
        return { name: c.name, desc: c.desc, kind: 'control' };
    }
    const b = blockFor(codon);
    return { name: b.name, desc: b.desc, kind: 'block' };
}

export function initUi(organism) {
    const genomeEl = $('genome');
    const codonsEl = $('codons');
    const canvas = $('game-canvas');
    let parentA = '';
    let parentB = '';

    const setGenome = (text, fromInput) => {
        const clean = sanitize(text);
        if (!fromInput) {
            genomeEl.value = clean;
        }
        organism.setGenome(clean);
        renderCodons(clean);
        renderStats();
        renderInspector(null);
    };

    // The codon strip is what makes a frameshift legible: every tile after an
    // inserted base is re-coloured, because it is now a different codon.
    function renderCodons(genome) {
        codonsEl.innerHTML = '';
        const list = codons(genome);
        list.forEach((codon, i) => {
            const el = document.createElement('div');
            el.className = 'codon' + (i >= organism.body.codonsRead ? ' dead' : '');
            el.textContent = codon;
            el.style.background = codonColor(codon);
            // Keep the label readable on both dark and bright tiles.
            const [r, g, b] = codonRgb(codon);
            el.style.color = r + g + b > 300 ? '#000' : '#fff';
            el.title = describe(codon).name;
            codonsEl.appendChild(el);
        });
    }

    function renderStats() {
        const body = organism.body;
        $('stats').textContent =
            `${body.blocks.length} blocks · ${body.codonsRead}/${body.codonsTotal} codons read · ` +
            `${body.unexpressed} unexpressed · ${genomeEl.value.length} bases`;
    }

    function renderInspector(block) {
        const el = $('inspector');
        if (!block) {
            el.innerHTML = '<span class="k">Hover a block to inspect it.</span>';
            return;
        }
        const [r, g, b] = codonRgb(block.codon);
        const info = describe(block.codon);
        el.innerHTML =
            `<div id="swatch" style="background:${codonColor(block.codon)}"></div>` +
            `<h2>${info.name}</h2>` +
            `<div><span class="k">codon</span> ${block.codon}</div>` +
            `<div><span class="k">rgb</span> ${r}, ${g}, ${b}</div>` +
            `<div><span class="k">facing</span> ${['up', 'right', 'down', 'left'][block.heading]}</div>` +
            `<p>${info.desc}</p>`;
    }

    function renderParents() {
        $('parent-a').innerHTML = `<span class="k">A:</span> ${parentA || '—'}`;
        $('parent-b').innerHTML = `<span class="k">B:</span> ${parentB || '—'}`;
    }

    genomeEl.addEventListener('input', () => {
        const clean = sanitize(genomeEl.value);
        if (clean !== genomeEl.value) {
            const at = genomeEl.selectionStart;
            genomeEl.value = clean;
            genomeEl.setSelectionRange(at - 1, at - 1);
        }
        setGenome(clean, true);
    });

    canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect();
        // The canvas is laid out fluid, so map CSS pixels back to canvas pixels.
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        const block = organism.blockAt(x, y);
        organism.highlight = block;
        renderInspector(block);
    });

    canvas.addEventListener('mouseleave', () => {
        organism.highlight = null;
        renderInspector(null);
    });

    $('random').onclick = () => setGenome(randomGenome(14));
    $('mutate').onclick = () => setGenome(mutate(genomeEl.value, 0.04));

    // A single inserted base at the front re-reads the whole genome.
    $('shift').onclick = () => {
        const base = BASES[Math.floor(Math.random() * BASES.length)];
        setGenome(base + genomeEl.value);
    };

    $('keep-a').onclick = () => { parentA = genomeEl.value; renderParents(); };
    $('keep-b').onclick = () => { parentB = genomeEl.value; renderParents(); };
    $('breed').onclick = () => {
        if (parentA && parentB) {
            setGenome(breed(parentA, parentB, 0.03));
        }
    };

    renderParents();
    setGenome(randomGenome(14));
}
