const paths = {
  house: '<path d="M3 11 12 3l9 8v10h-6v-6H9v6H3Z"/><path d="M7 8V4h3v2"/>',
  port: '<path d="M12 3v15M7 7h10M5 14c0 5 3 7 7 7s7-2 7-7M3 14h4M17 14h4"/><path d="M8 3h8"/>',
  fort: '<path d="M4 21V7h4V3h3v4h3V3h3v4h3v14Z"/><path d="M9 21v-7h6v7"/>',
  drone: '<path d="M8 9h8v6H8ZM10 15v3M14 15v3M5 6 8 9M19 6l-3 3M3 5h4M17 5h4"/><path d="M10 18h4v3h-4Z"/>',
  missile: '<path d="m12 2 4 5v9l-4 5-4-5V7Z"/><path d="M8 12 4 17v4l5-3M16 12l4 5v4l-5-3M10 7h4"/>',
  aa: '<path d="M4 21h16M6 21v-5h12v5M9 16v-5h6v5M12 11V4M12 4l7-2M12 4 5 2"/><path d="M17 2h4v4M5 2H2v3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  play: '<path d="m7 3 14 9-14 9Z"/>',
  arrow: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  copy: '<rect x="8" y="8" width="13" height="13"/><path d="M16 8V3H3v13h5"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4ZM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4ZM16 9l6 6M22 9l-6 6"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 3h10v5c0 5-2 9-5 9s-5-4-5-9ZM7 5H3v3c0 3 2 5 5 5M17 5h4v3c0 3-2 5-5 5"/>',
  crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  chat: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  bolt: '<path d="m13 2-9 12h8l-1 8 9-12h-8Z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
};
export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" shape-rendering="crispEdges" aria-hidden="true">${paths[name] || paths.info}</svg>`;
}
