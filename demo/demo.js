import { croot } from '../croot.js';

const deck = croot('[data-croot]');
const pos = document.getElementById('pos');

function showPos() {
  pos.textContent = deck.isOverview ? 'overview' : `${deck.index + 1} / ${deck.steps.length}`;
}

document.querySelector('.hud').addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  if (act) deck[act]();
});
deck.root.addEventListener('croot:enter', showPos);
deck.root.addEventListener('croot:overview', showPos);
showPos();
