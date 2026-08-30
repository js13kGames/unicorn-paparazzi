import { Engine } from './engine.js';
import { Organism } from './organism.js';
import { initUi } from './ui.js';

const canvas = document.getElementById('game-canvas');
const engine = new Engine(canvas);
const organism = engine.add(new Organism(canvas));

initUi(organism);
engine.start();
