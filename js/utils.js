export function addLog(msg, color = 'text-cyan') {
    const logDiv = document.getElementById('game-log');
    if (!logDiv) return;
    const line = document.createElement('div');
    line.className = color;
    line.innerText = `> ${msg}`;
    logDiv.appendChild(line);
    if (logDiv.children.length > 5) logDiv.removeChild(logDiv.children[0]);
    logDiv.scrollTop = logDiv.scrollHeight;
}
