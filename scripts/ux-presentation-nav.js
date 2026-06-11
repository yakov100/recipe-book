
    const slides = document.querySelectorAll('.slide');
    const total = slides.length;
    let current = 0;

    const prevBtn = document.getElementById('prev');
    const nextBtn = document.getElementById('next');
    const counter = document.getElementById('counter');
    const dotsEl = document.getElementById('dots');

    for (let i = 0; i < total; i++) {
      const d = document.createElement('button');
      d.className = 'dot' + (i === 0 ? ' active' : '');
      d.type = 'button';
      d.setAttribute('aria-label', 'שקופית ' + (i + 1));
      d.addEventListener('click', () => go(i));
      dotsEl.appendChild(d);
    }

    const dots = dotsEl.querySelectorAll('.dot');

    function go(n) {
      slides[current].classList.remove('active');
      dots[current].classList.remove('active');
      current = Math.max(0, Math.min(total - 1, n));
      slides[current].classList.add('active');
      dots[current].classList.add('active');
      counter.textContent = (current + 1) + ' / ' + total;
      prevBtn.disabled = current === 0;
      nextBtn.disabled = current === total - 1;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    prevBtn.addEventListener('click', () => go(current - 1));
    nextBtn.addEventListener('click', () => go(current + 1));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') go(current + 1);
      if (e.key === 'ArrowRight') go(current - 1);
    });
  