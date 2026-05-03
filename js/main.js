// NoHungryPets - Shared JS

// Highlight active nav link
document.addEventListener('DOMContentLoaded', () => {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(a => {
    if (a.getAttribute('href') === page) a.classList.add('active');
  });
});

// Simple toast notification
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed; bottom:2rem; left:50%; transform:translateX(-50%);
    background:${type === 'success' ? '#3A7D5A' : '#E8733A'}; color:white;
    padding:0.9rem 2rem; border-radius:50px; font-weight:600; font-size:0.9rem;
    box-shadow:0 8px 32px rgba(0,0,0,0.2); z-index:9999;
    animation: fadeUp 0.3s ease both;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
