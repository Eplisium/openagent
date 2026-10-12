import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import stripAnsi from 'strip-ansi';
import {
  frameAt, formatLiveElapsed, shimmer, hideCursor, createActivityIndicator, SPINNER_FRAMES, FRAME_MS,
} from '../../src/cli/animation.js';
import { printEnhancedToolCallStart, printEnhancedToolCallEnd } from '../../src/cli/display.js';

const THEME = { accent: '#89b4fa', muted: '#6c7086', text: '#cdd6f4', tool: '#cba6f7', success: '#a6e3a1', error: '#f38ba8' };

let out;
let ttyBefore;

beforeEach(() => {
  vi.useFakeTimers();
  out = [];
  ttyBefore = process.stdout.isTTY;
  process.stdout.isTTY = true;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(`${a.join(' ')}\n`); });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  process.stdout.isTTY = ttyBefore;
});

const joined = () => out.join('');
const count = (needle) => joined().split(needle).length - 1;

describe('animation primitives', () => {
  it('derives frames from the clock so animators stay in phase', () => {
    expect(frameAt(0)).toBe(SPINNER_FRAMES[0]);
    expect(frameAt(FRAME_MS * 3)).toBe(SPINNER_FRAMES[3]);
    expect(frameAt(FRAME_MS * SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0]);
  });

  it('hides live elapsed under a second and formats minutes', () => {
    expect(formatLiveElapsed(400)).toBe('');
    expect(formatLiveElapsed(1500)).toBe('1.5s');
    expect(formatLiveElapsed(65000)).toBe('1m05s');
  });

  it('shimmer keeps the text intact', () => {
    expect(stripAnsi(shimmer('Thinking…', '#6c7086', '#ffffff', 1234))).toBe('Thinking…');
  });

  it('balances cursor hide and show and ignores double release', () => {
    const a = hideCursor();
    const b = hideCursor();
    a(); a();
    expect(count('\x1b[?25h')).toBe(0);
    b();
    expect(count('\x1b[?25l')).toBe(1);
    expect(count('\x1b[?25h')).toBe(1);
  });
});

describe('activity indicator', () => {
  it('animates, pauses cleanly and resumes with the clock intact via around()', () => {
    const activity = createActivityIndicator({ theme: THEME });
    activity.resume('Thinking');
    vi.advanceTimersByTime(2500);
    expect(activity.running).toBe(true);
    expect(stripAnsi(joined())).toMatch(/Thinking….*2\.\ds/);

    activity.around(() => console.log('status line'));
    expect(activity.running).toBe(true);
    expect(joined()).toContain('\r\x1b[2K');

    activity.dispose();
    expect(activity.running).toBe(false);
    expect(count('\x1b[?25l')).toBe(count('\x1b[?25h'));
  });

  it('never draws when stdout is not a TTY', () => {
    process.stdout.isTTY = false;
    const activity = createActivityIndicator({ theme: THEME });
    activity.resume('Thinking');
    vi.advanceTimersByTime(1000);
    expect(joined()).toBe('');
  });
});

describe('tool call visuals', () => {
  it('hands the line to the tool spinner, then back to thinking, without leaking the cursor', () => {
    const activity = createActivityIndicator({ theme: THEME });
    const cli = { theme: THEME, _activity: activity, _toolLineStates: [] };
    activity.resume('Thinking');

    printEnhancedToolCallStart(cli, 'read_file', { path: 'a.js' }, 1, Date.now());
    expect(activity.running).toBe(false);
    vi.advanceTimersByTime(500);
    expect(stripAnsi(joined())).toContain('read_file');

    printEnhancedToolCallEnd(cli, 'read_file', { success: true, result: {} }, Date.now(), 1);
    expect(activity.running).toBe(true);

    activity.dispose();
    expect(count('\x1b[?25l')).toBe(count('\x1b[?25h'));
    expect(joined()).not.toMatch(/\x1b\[\d+A/);
  });

  it('redraws a multi-tool batch inside synchronized-output markers', () => {
    const cli = { theme: THEME, _toolLineStates: [] };
    for (let i = 1; i <= 3; i++) printEnhancedToolCallStart(cli, `tool_${i}`, { path: `f${i}` }, i, Date.now());
    vi.advanceTimersByTime(300);
    expect(count('\x1b[?2026h')).toBe(count('\x1b[?2026l'));
    expect(count('\x1b[?2026h')).toBeGreaterThan(1);
    for (let i = 1; i <= 3; i++) printEnhancedToolCallEnd(cli, `tool_${i}`, { success: true, result: {} }, Date.now(), i);
    expect(count('\x1b[?25l')).toBe(count('\x1b[?25h'));
  });
});
