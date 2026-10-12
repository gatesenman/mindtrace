/** Lucide-compatible inline SVG icons (stroke 1.75). No emoji. */
window.MTIcons = {
  _svg(paths, opts = {}) {
    const s = opts.size || 20;
    return `<svg class="icon" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  },
  layout: () => MTIcons._svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  clock: () => MTIcons._svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  book: () => MTIcons._svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4v15.5"/><path d="M8 4h12v13H8z"/>'),
  wiki: () => MTIcons._svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M12 4v13"/><path d="M8 8h8"/>'),
  message: () => MTIcons._svg('<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>'),
  radar: () => MTIcons._svg('<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><circle cx="12" cy="12" r="4"/>'),
  settings: () => MTIcons._svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  search: () => MTIcons._svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  panel: () => MTIcons._svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  sun: () => MTIcons._svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: () => MTIcons._svg('<path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z"/>'),
  export: () => MTIcons._svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  spark: () => MTIcons._svg('<path d="M12 3v6"/><path d="M12 15v6"/><path d="m5 8 4 4"/><path d="m15 12 4 4"/><path d="m5 16 4-4"/><path d="m15 12 4-4"/>'),
  plus: () => MTIcons._svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  x: () => MTIcons._svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  min: () => MTIcons._svg('<path d="M5 12h14"/>', { size: 14 }),
  max: () => MTIcons._svg('<rect x="6" y="6" width="12" height="12" rx="1"/>', { size: 12 }),
  close: () => MTIcons._svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', { size: 14 }),
  chevron: () => MTIcons._svg('<path d="m9 18 6-6-6-6"/>'),
  user: () => MTIcons._svg('<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>'),
  inbox: () => MTIcons._svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
  empty: () => `<svg class="empty-illu" width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden="true">
    <rect x="18" y="22" width="84" height="56" rx="10" stroke="currentColor" stroke-width="1.5" opacity=".35"/>
    <path d="M34 44h52M34 56h36" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".45"/>
    <circle cx="92" cy="30" r="14" fill="var(--brand-soft)" stroke="var(--brand)" stroke-width="1.5"/>
    <path d="M92 24v8M88 30h8" stroke="var(--brand)" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`
};
