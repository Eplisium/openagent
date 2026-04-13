/**
 * 🎨 Canvas Tools — Visual workspace via AG-UI protocol
 * 
 * Emits canvas events through the existing AG-UI server so frontends
 * can render a live visual workspace (diagrams, images, layouts).
 */

export function createCanvasTools(aguiServer) {
  function emit(eventType, data) {
    if (!aguiServer) {
      return { success: false, error: 'AG-UI server not running. Start it with agui_start first.' };
    }
    aguiServer.emit({ type: eventType, data });
    return { success: true, event: eventType };
  }

  return [
    {
      name: 'canvas_draw',
      description: 'Draw a shape on the canvas (rect, circle, line, text). Emits via AG-UI.',
      category: 'canvas',
      destructive: false,
      timeout: 5000,
      parameters: {
        type: 'object',
        properties: {
          shape: { type: 'string', enum: ['rect', 'circle', 'line', 'text'], description: 'Shape type' },
          x: { type: 'number', description: 'X position' },
          y: { type: 'number', description: 'Y position' },
          w: { type: 'number', description: 'Width (rect)' },
          h: { type: 'number', description: 'Height (rect)' },
          r: { type: 'number', description: 'Radius (circle)' },
          x2: { type: 'number', description: 'End X (line)' },
          y2: { type: 'number', description: 'End Y (line)' },
          text: { type: 'string', description: 'Text content (text shape)' },
          color: { type: 'string', description: 'Color (CSS format)', default: '#000000' },
          fontSize: { type: 'number', description: 'Font size (text)', default: 16 },
        },
        required: ['shape', 'x', 'y'],
      },
      async execute(args) {
        return emit('canvas_draw', args);
      },
    },

    {
      name: 'canvas_image',
      description: 'Push an image to the canvas at a specific position.',
      category: 'canvas',
      destructive: false,
      timeout: 10000,
      parameters: {
        type: 'object',
        properties: {
          src: { type: 'string', description: 'Image URL or base64 data URI' },
          x: { type: 'number', description: 'X position', default: 0 },
          y: { type: 'number', description: 'Y position', default: 0 },
          w: { type: 'number', description: 'Display width (optional)' },
          h: { type: 'number', description: 'Display height (optional)' },
        },
        required: ['src'],
      },
      async execute(args) {
        return emit('canvas_image', args);
      },
    },

    {
      name: 'canvas_clear',
      description: 'Clear all content from the canvas.',
      category: 'canvas',
      destructive: true,
      timeout: 5000,
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute() {
        return emit('canvas_clear', {});
      },
    },

    {
      name: 'canvas_layout',
      description: 'Set the canvas layout mode (grid, freeform, split).',
      category: 'canvas',
      destructive: false,
      timeout: 5000,
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['grid', 'freeform', 'split'], description: 'Layout mode' },
          columns: { type: 'number', description: 'Grid columns (grid mode)', default: 2 },
        },
        required: ['mode'],
      },
      async execute(args) {
        return emit('canvas_layout', args);
      },
    },

    {
      name: 'canvas_markdown',
      description: 'Render markdown content on the canvas (for documentation, diagrams via Mermaid, etc.).',
      category: 'canvas',
      destructive: false,
      timeout: 5000,
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Markdown content to render' },
          x: { type: 'number', description: 'X position', default: 0 },
          y: { type: 'number', description: 'Y position', default: 0 },
        },
        required: ['content'],
      },
      async execute(args) {
        return emit('canvas_markdown', args);
      },
    },
  ];
}

export default createCanvasTools;
