import { WebGLRenderer, Scene, OrthographicCamera, BufferGeometry, BufferAttribute, DynamicDrawUsage,
  PointsMaterial, Points, LineBasicMaterial, LineSegments } from 'three';
import { MAX_TRAIL_POINTS } from '../core/trace.js';

// Render-only mirroring. Core samples and captures remain in original image coordinates.
export class TraceRenderer {
  constructor(canvas, { onFailure = () => {}, mirrored = true, createRenderer = options => new WebGLRenderer(options) } = {}) {
    this.canvas = canvas; this.onFailure = onFailure; this.mirrored = mirrored;
    this.disposed = false; this.failed = false; this.layers = {};
    this.loss = event => { event.preventDefault(); this.fail('context_lost'); };
    this.scene = new Scene();
    // Transparent stars can share the camera's exact image rectangle.
    this.scene.background = null;
    this.camera = new OrthographicCamera(-.5, .5, .5, -.5, .1, 10);
    this.camera.position.z = 1;
    try {
      this.renderer = createRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      canvas.addEventListener('webglcontextlost', this.loss);
      for (const [name, count, color, size, line] of [
        ['trail', MAX_TRAIL_POINTS, '#9abcaa', 5, false], ['targets', 12, '#8c713f', 5, false],
        ['lines', 132, '#d1eaa4', 1, true], ['captures', 12, '#eaf5d4', 14, false], ['current', 1, '#a8c9e7', 14, false]
      ]) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage));
        geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage));
        geometry.setDrawRange(0, 0);
        const material = line ? new LineBasicMaterial({ color, vertexColors: true, depthTest: false }) :
          new PointsMaterial({ color, size, sizeAttenuation: false, vertexColors: true, depthTest: false });
        const object = line ? new LineSegments(geometry, material) : new Points(geometry, material);
        object.frustumCulled = false;
        this.scene.add(object); this.layers[name] = object;
      }
    } catch { this.fail('webgl_unavailable'); this.dispose(); }
  }
  fail(reason) {
    if (this.failed || this.disposed) return;
    this.failed = true; this.onFailure(reason);
  }
  resize(width, height, pixelRatio = 1) {
    if (this.failed || this.disposed || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    try {
      // Bound GPU backing area as well as device scale on very large displays.
      const ratio = Math.min(2, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1), 2048 / Math.max(width, height));
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
      if (this.frame) this.draw(this.frame);
    } catch { this.fail('render_failed'); }
  }
  draw(frame) {
    if (this.failed || this.disposed) return;
    try {
      this.frame = frame;
      for (const [name, points] of Object.entries({
        trail: frame.trail, targets: frame.targets, captures: frame.captures, lines: frame.lines.flat(),
        current: frame.current ? [frame.current] : []
      })) {
        const geometry = this.layers[name].geometry, positions = geometry.getAttribute('position'), colors = geometry.getAttribute('color');
        if (points.length > positions.count) throw Error('Render capacity exceeded');
        // Erase unused slots as well as lowering drawRange: reset releases measured data from CPU buffers.
        positions.array.fill(0); colors.array.fill(0);
        for (const [i, p] of points.entries()) {
          if (![p.x, p.y].every(Number.isFinite)) throw Error('Invalid point');
          positions.setXYZ(i, (this.mirrored ? 1 - p.x : p.x) - .5, .5 - p.y, 0);
          const brightness = name === 'trail' ? p.brightness : 1;
          colors.setXYZ(i, brightness, brightness, brightness);
        }
        positions.needsUpdate = colors.needsUpdate = true;
        geometry.setDrawRange(0, points.length);
        this.layers[name].visible = points.length > 0;
      }
      this.renderer.render(this.scene, this.camera);
    } catch { this.fail('render_failed'); }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.loss);
    for (const object of Object.values(this.layers)) {
      object.geometry.getAttribute('position').array.fill(0);
      object.geometry.getAttribute('color').array.fill(0);
      object.geometry.dispose(); object.material.dispose();
    }
    this.layers = {}; this.frame = null; this.scene.clear();
    this.renderer?.dispose(); this.renderer?.forceContextLoss();
    // Erase the visible surface without creating a replacement GPU context.
    this.canvas.width = this.canvas.height = 0;
  }
}
