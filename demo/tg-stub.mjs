// Emulates what the Telegram client injects into a Mini App: window.Telegram.WebApp with signed
// initData, theme params (+ the CSS variables the real SDK sets), and native Main/Back buttons
// (drawn here as a fixed bar so screenshots show what Telegram would render).
export function telegramStub({ initData, dark }) {
  const theme = dark
    ? { bg_color: "#17212b", text_color: "#f5f5f5", hint_color: "#8f9ba8", link_color: "#6ab3f3", button_color: "#5288c1", button_text_color: "#ffffff", secondary_bg_color: "#232e3c", section_bg_color: "#1d2733", destructive_text_color: "#ec3942", section_separator_color: "#111921" }
    : { bg_color: "#f7f7f5", text_color: "#1c1d21", hint_color: "#5e6270", link_color: "#1f5fd6", button_color: "#2f6feb", button_text_color: "#ffffff", secondary_bg_color: "#efefec", section_bg_color: "#ffffff", destructive_text_color: "#b91c1c", section_separator_color: "#ececea" };
  return `(() => {
    const theme = ${JSON.stringify(theme)};
    const setVars = () => { const root = document.documentElement; if (!root) return false;
      for (const [k, v] of Object.entries(theme)) root.style.setProperty('--tg-theme-' + k.replace(/_/g, '-'), v);
      root.style.setProperty('--tg-viewport-stable-height', innerHeight + 'px'); return true; };
    if (!setVars()) document.addEventListener('readystatechange', setVars, { once: true });
    const mk = (cls) => { const s = { text: '', visible: false, active: true, progress: false, cbs: new Set() };
      const api = {
        setText(t) { s.text = t; draw(); return api; }, show() { s.visible = true; draw(); return api; }, hide() { s.visible = false; draw(); return api; },
        enable() { s.active = true; draw(); return api; }, disable() { s.active = false; draw(); return api; },
        showProgress() { s.progress = true; draw(); return api; }, hideProgress() { s.progress = false; draw(); return api; },
        onClick(cb) { s.cbs.add(cb); return api; }, offClick(cb) { s.cbs.delete(cb); return api; }, setParams(p) { if (p.color) s.color = p.color; if (p.text_color) s.textColor = p.text_color; draw(); return api; }, _s: s };
      return api; };
    const main = mk('main'); const back = mk('back');
    function draw() {
      if (!document.body) return requestAnimationFrame(draw);
      let el = document.getElementById('__tg_main');
      if (!el) { el = document.createElement('button'); el.id = '__tg_main'; el.setAttribute('aria-label', 'Telegram main button');
        el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;height:50px;border:0;border-radius:12px;font:600 16px system-ui;z-index:99';
        el.onclick = () => main._s.cbs.forEach((cb) => cb()); document.body.appendChild(el); }
      el.style.display = main._s.visible ? 'block' : 'none';
      // Real Telegram draws this button outside the web view (the viewport shrinks); emulate that
      // by lifting the page's fixed bottom bars above it instead of covering them.
      let st = document.getElementById('__tg_main_space');
      if (!st) { st = document.createElement('style'); st.id = '__tg_main_space'; document.head.appendChild(st); }
      st.textContent = main._s.visible ? '.tg .fixed.bottom-0,.tg .sticky.bottom-0{bottom:74px!important} .tg{padding-bottom:74px}' : '';
      el.style.background = main._s.color || theme.button_color; el.style.color = main._s.textColor || theme.button_text_color; el.style.opacity = main._s.active ? '1' : '.5';
      el.textContent = main._s.progress ? '…' : main._s.text;
    }
    window.Telegram = { WebApp: {
      initData: ${JSON.stringify(initData)}, colorScheme: ${dark ? "'dark'" : "'light'"}, themeParams: theme, platform: 'ios',
      ready() {}, expand() {}, onEvent() {}, offEvent() {}, MainButton: main, chrome: {},
      setHeaderColor(c) { this.chrome.header = c; }, setBackgroundColor(c) { this.chrome.bg = c; document.documentElement.style.background = c; }, setBottomBarColor(c) { this.chrome.bar = c; },
      BackButton: { show() { back._s.visible = true; }, hide() { back._s.visible = false; }, onClick(cb) { back._s.cbs.add(cb); }, offClick(cb) { back._s.cbs.delete(cb); } },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
      _main: main._s, _back: back._s,
    } };
  })();`;
}
