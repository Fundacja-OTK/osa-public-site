// Motyw i zwinięte menu ustawiane przed pierwszym malowaniem (zwykły skrypt, nie moduł — wykonuje się od razu; dawniej inline w index.html,
// przeniesiony ze względu na CSP script-src 'self').
try { var t = JSON.parse(localStorage.getItem('otk-theme') || 'null'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) { /* bez magazynu */ }
try { if (JSON.parse(localStorage.getItem('osa-sb-collapsed') || 'false')) document.documentElement.classList.add('sb-collapsed'); } catch (e) { /* bez magazynu */ }
