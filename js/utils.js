// Messages flottants discrets (bas-droite), apparition puis fondu de sortie.
export function addLog(msg, color = 'text-cyan') {
    const root = document.getElementById('game-log');
    if (!root) return;
    const line = document.createElement('div');
    if (typeof color === 'string' && color[0] === '#') line.style.color = color;   // couleur hex (rareté)
    else line.className = color;
    line.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    line.style.opacity = '0';
    line.style.transform = 'translateY(6px)';
    line.innerText = msg;
    root.appendChild(line);
    requestAnimationFrame(() => { line.style.opacity = '1'; line.style.transform = 'translateY(0)'; });
    while (root.children.length > 6) root.removeChild(root.firstChild);
    // fondu de sortie puis suppression
    setTimeout(() => { line.style.opacity = '0'; line.style.transform = 'translateY(-4px)'; }, 3500);
    setTimeout(() => { line.remove(); }, 4200);
}
