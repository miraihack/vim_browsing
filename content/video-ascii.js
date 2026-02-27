import { ASCII_RAMP, CHAR_ASPECT_RATIO, VIDEO_TARGET_FPS, COLOR_QUANT_SHIFT } from '../shared/constants.js';

/**
 * Real-time video → ASCII art player.
 *
 * Captures frames from a <video> element via an offscreen canvas,
 * converts pixel data to ASCII characters, and renders into a <pre> element.
 * Audio continues playing from the original <video>.
 */
export class VideoAsciiPlayer {
  constructor(videoElement) {
    this.video = videoElement;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.preEl = null;
    this.progressEl = null;
    this.container = null;
    this._rafId = null;
    this._lastFrameTime = 0;
    this._frameInterval = 1000 / VIDEO_TARGET_FPS;
    this._cols = 0;
    this._rows = 0;
    this._running = false;

    // Pre-compute HTML-escaped ramp characters
    const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    this._escapedRamp = Array.from(ASCII_RAMP, ch => escapeMap[ch] || ch);
    this._rampMax = ASCII_RAMP.length - 1;
    this._quantShift = COLOR_QUANT_SHIFT;
  }

  /**
   * Start rendering ASCII video into the given container element.
   * Clears the container and inserts <pre> elements for video + progress bar.
   */
  start(container) {
    this.container = container;
    container.innerHTML = '';

    // ASCII frame display
    this.preEl = document.createElement('pre');
    this.preEl.style.cssText = 'margin:0;padding:0;overflow:hidden;flex:1;line-height:1;font-size:inherit;color:inherit;white-space:pre;';
    container.appendChild(this.preEl);

    // Progress bar
    this.progressEl = document.createElement('pre');
    this.progressEl.style.cssText = 'margin:0;padding:4px 1ch;line-height:1.4;font-size:inherit;color:inherit;white-space:pre;flex-shrink:0;';
    container.appendChild(this.progressEl);

    // Calculate dimensions based on container size
    this._calculateDimensions();

    // Ensure video is playing
    if (this.video.paused) {
      this.video.play().catch(() => {});
    }

    this._running = true;
    this._lastFrameTime = 0;
    this._rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  /**
   * rAF loop with timestamp-based throttling to target FPS.
   */
  _loop(timestamp) {
    if (!this._running) return;

    const elapsed = timestamp - this._lastFrameTime;
    if (elapsed >= this._frameInterval) {
      this._lastFrameTime = timestamp - (elapsed % this._frameInterval);
      this._captureAndRender();
      this._updateProgressBar();
    }

    this._rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  /**
   * Capture current video frame, convert to ASCII, update <pre>.
   */
  _captureAndRender() {
    if (!this.video || !this.preEl) return;

    // Recalculate if container resized
    this._calculateDimensions();

    if (this._cols < 1 || this._rows < 1) return;

    this.canvas.width = this._cols;
    this.canvas.height = this._rows;

    try {
      this.ctx.drawImage(this.video, 0, 0, this._cols, this._rows);
      const imageData = this.ctx.getImageData(0, 0, this._cols, this._rows);
      this.preEl.innerHTML = this._pixelsToColoredHtml(imageData.data, this._cols, this._rows);
    } catch {
      // DRM content or tainted canvas (use textContent for plain text)
      this.preEl.textContent = '\n\n  [DRM protected content - cannot capture video frames]';
    }
  }

  /**
   * Convert raw RGBA pixel data to colored HTML spans.
   * Groups consecutive characters with the same quantized color
   * into single <span> elements to minimize DOM node count.
   */
  _pixelsToColoredHtml(pixels, width, height) {
    const ramp = this._escapedRamp;
    const rampMax = this._rampMax;
    const shift = this._quantShift;
    const parts = [];

    for (let y = 0; y < height; y++) {
      let spanChars = '';
      let prevR = -1, prevG = -1, prevB = -1;

      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const ch = ramp[Math.floor((lum / 255) * rampMax)];

        // Quantize color for grouping
        const qr = r >> shift;
        const qg = g >> shift;
        const qb = b >> shift;

        if (qr !== prevR || qg !== prevG || qb !== prevB) {
          // Flush previous span
          if (spanChars) {
            parts.push(`<span style="color:rgb(${prevR << shift},${prevG << shift},${prevB << shift})">${spanChars}</span>`);
          }
          spanChars = ch;
          prevR = qr; prevG = qg; prevB = qb;
        } else {
          spanChars += ch;
        }
      }
      // Flush last span of the line
      if (spanChars) {
        parts.push(`<span style="color:rgb(${prevR << shift},${prevG << shift},${prevB << shift})">${spanChars}</span>`);
      }
      if (y < height - 1) parts.push('\n');
    }

    return parts.join('');
  }

  /**
   * Update the progress bar display.
   * Format: ▶ 01:23 [=====>---------] 05:00 [1.0x]
   */
  _updateProgressBar() {
    if (!this.progressEl || !this.video) return;

    const v = this.video;
    const cur = v.currentTime || 0;
    const dur = v.duration || 0;
    const icon = v.paused ? '⏸' : '▶';
    const speed = v.playbackRate.toFixed(1);
    const vol = v.muted ? '🔇' : `🔊${Math.round(v.volume * 100)}%`;

    const barWidth = Math.max(10, this._cols - 30);
    const progress = dur > 0 ? cur / dur : 0;
    const filled = Math.round(progress * barWidth);
    const bar = '='.repeat(filled) + '>' + '-'.repeat(Math.max(0, barWidth - filled - 1));

    this.progressEl.textContent = `${icon} ${this._formatTime(cur)} [${bar}] ${this._formatTime(dur)} [${speed}x] ${vol}`;
  }

  /**
   * Calculate ASCII grid dimensions from container size.
   */
  _calculateDimensions() {
    if (!this.container) return;

    const rect = this.container.getBoundingClientRect();
    // Approximate character cell size: 14px font → ~8.4px wide, ~19.6px tall
    // But we use line-height:1 for the video pre, so ~14px tall
    const charW = 8.4;
    const charH = 14; // line-height: 1 at 14px font

    // Reserve 2 lines for progress bar
    const availH = rect.height - 30;
    const availW = rect.width;

    this._cols = Math.max(10, Math.floor(availW / charW));
    // Apply character aspect ratio: characters are taller than wide
    this._rows = Math.max(5, Math.floor(availH / charH));

    // Adjust for video aspect ratio
    if (this.video.videoWidth && this.video.videoHeight) {
      const videoAspect = this.video.videoWidth / this.video.videoHeight;
      const gridAspect = (this._cols * charW) / (this._rows * charH);

      if (gridAspect > videoAspect) {
        // Grid is wider than video — shrink cols
        this._cols = Math.max(10, Math.floor(this._rows * charH * videoAspect / charW));
      } else {
        // Grid is taller than video — shrink rows
        this._rows = Math.max(5, Math.floor(this._cols * charW / (videoAspect * charH)));
      }
    }
  }

  _formatTime(seconds) {
    if (!isFinite(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ── Playback controls ──

  togglePlay() {
    if (this.video.paused) {
      this.video.play().catch(() => {});
    } else {
      this.video.pause();
    }
  }

  seek(delta) {
    this.video.currentTime = Math.max(0, Math.min(
      this.video.currentTime + delta,
      this.video.duration || 0
    ));
  }

  adjustVolume(delta) {
    this.video.volume = Math.max(0, Math.min(1, this.video.volume + delta));
  }

  toggleMute() {
    this.video.muted = !this.video.muted;
  }

  adjustSpeed(delta) {
    this.video.playbackRate = Math.max(0.25, Math.min(4, this.video.playbackRate + delta));
  }

  stop() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.video.pause();
    if (this.preEl && this.preEl.parentNode) {
      this.preEl.parentNode.removeChild(this.preEl);
    }
    if (this.progressEl && this.progressEl.parentNode) {
      this.progressEl.parentNode.removeChild(this.progressEl);
    }
    this.preEl = null;
    this.progressEl = null;
    this.container = null;
  }
}
