document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth' });
  });
});

const phrases = ['Editing styles', 'Validating HXML', 'Refreshing preview'];
const activeLabel = document.querySelector('.activity.active strong');
let phraseIndex = 0;
setInterval(() => {
  phraseIndex = (phraseIndex + 1) % phrases.length;
  activeLabel.textContent = phrases[phraseIndex];
}, 2200);
