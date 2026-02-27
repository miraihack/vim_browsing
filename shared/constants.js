// ASCII brightness ramp (dark → light)
export const ASCII_RAMP = ' .:-=+*#%@';

// Character aspect ratio correction (monospace chars are ~2x taller than wide)
export const CHAR_ASPECT_RATIO = 0.5;

// Maximum ASCII art width in characters
export const ASCII_MAX_WIDTH = 140;

// Minimum image dimension to attempt ASCII conversion (skip tracking pixels)
export const IMAGE_MIN_SIZE = 4;

// Catppuccin Mocha-inspired color scheme
export const COLORS = {
  bg: '#1e1e2e',
  surface: '#313244',
  overlay: '#45475a',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  heading: '#f38ba8',
  link: '#89b4fa',
  linkVisited: '#cba6f7',
  keyword: '#f9e2af',
  string: '#a6e3a1',
  comment: '#6c7086',
  gutter: '#585b70',
  gutterBg: '#181825',
  statusBg: '#313244',
  statusText: '#cdd6f4',
  commandBg: '#1e1e2e',
  commandText: '#cdd6f4',
  cursor: '#f5e0dc',
  visual: '#45475a',
  search: '#f9e2af',
  modeNormal: '#89b4fa',
  modeInsert: '#a6e3a1',
  modeVisual: '#cba6f7',
  modeCommand: '#f9e2af',
  modeVideo: '#f38ba8',
  tilde: '#585b70',
  separator: '#45475a',
  code: '#a6e3a1',
  codeBg: '#181825',
};

// Vim modes
export const MODE = {
  NORMAL: 'NORMAL',
  COMMAND: 'COMMAND',
  VISUAL: 'VISUAL',
  HINT: 'HINT',
  VIDEO: 'VIDEO',
};

// Scroll amounts
export const SCROLL = {
  LINE: 1,
  HALF_PAGE: 15,
  PAGE: 30,
};

// Virtual scroll buffer (lines rendered above/below viewport)
export const VIRTUAL_SCROLL_BUFFER = 20;

// Hint characters for link navigation
export const HINT_CHARS = 'asdfghjklqwertyuiopzxcvbnm';

// Video player settings
export const VIDEO_TARGET_FPS = 12;
export const VIDEO_SEEK_STEP = 5;
export const VIDEO_VOLUME_STEP = 0.1;

// Multi-key timeout in ms
export const MULTI_KEY_TIMEOUT = 500;
