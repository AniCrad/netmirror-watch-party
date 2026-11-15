import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../extension/content/index.js', import.meta.url), 'utf8');
function setup(role = 'guest', namespace = 'chrome') {
  let now = 10000;
  let interval, listener;
  const sent = [];
  const handlers = new Map();
  function element() {
    return {
      parentNode: null, children: [], hidden: false, textContent: '',
      append(...items) { for (const item of items) { item.parentNode = this; this.children.push(item); } },
      remove() { this.parentNode = null; },
      attachShadow() { return element(); },
      addEventListener() {},
    };
  }
  const video = {
    currentTime: 0, duration: 3600, playbackRate: 1, paused: true, ended: false,
    readyState: 4, seeking: false, rejected: false, plays: 0,
    getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    addEventListener: (type, callback) => handlers.set(type, callback),
    removeEventListener: type => handlers.delete(type),
    play() { this.plays++; if (this.rejected) return Promise.reject(new Error('Autoplay blocked')); this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
  };
  const config = { active: true, connected: true, hostOnline: true, role };
  const context = vm.createContext({
    [namespace]: { runtime: { id: 'test',
      sendMessage: async value => { sent.push(value); return value.type === 'video-report' ? config : {}; },
      onMessage: { addListener: callback => { listener = callback; } },
    } },
    document: { querySelectorAll: selector => selector === 'video' ? [video] : [],
      documentElement: element(), createElement: element, addEventListener() {}, fullscreenElement: null },
    getComputedStyle: () => ({ visibility: 'visible' }),
    Date: { now: () => now },
    setInterval: callback => { interval = callback; return 1; }, clearInterval() {},
  });
  vm.runInContext(source, context);
  return { video, sent, config,
    tick: () => interval(),
    advance: ms => { now += ms; },
    event: type => handlers.get(type)?.({ type }),
    receive: value => listener(value),
    state: values => listener({ type: 'party-state', clockOffset: 0,
      state: { position: 100, paused: false, rate: 1, duration: 3600, updatedAt: now, ...values } }),
  };
}

test('guest follows play, seek, pause and playback speed without publishing', async () => {
  const app = setup();
  await app.tick();
  app.state({ position: 120, rate: 1.5 });
  assert.equal(app.video.currentTime, 120);
  assert.equal(app.video.playbackRate, 1.5);
  assert.equal(app.video.paused, false);
  app.state({ position: 800, paused: true });
  assert.equal(app.video.currentTime, 800);
  assert.equal(app.video.paused, true);
  app.event('seeked');
  assert.equal(app.sent.filter(message => message.type === 'video-state').length, 0);
});

test('guest corrects drift using elapsed time and server clock offset', async () => {
  const app = setup();
  await app.tick();
  app.receive({ type: 'party-state', clockOffset: 1000,
    state: { position: 120, rate: 2, paused: false, duration: 3600, updatedAt: 10000 } });
  assert.equal(app.video.currentTime, 122);
  app.advance(3000);
  await app.tick();
  assert.equal(app.video.currentTime, 128);
});

test('autoplay rejection does not cause repeated play attempts', async () => {
  const app = setup();
  await app.tick();
  app.video.rejected = true;
  app.state({});
  await Promise.resolve();
  await app.tick();
  await app.tick();
  assert.equal(app.video.plays, 1);
  assert.equal(app.video.paused, true);
});

test('mismatched movie duration is not seeked and disconnect pauses a guest', async () => {
  const app = setup();
  await app.tick();
  app.state({ duration: 1800 });
  assert.equal(app.video.currentTime, 0);
  assert.equal(app.video.paused, true);
  app.state({});
  assert.equal(app.video.paused, false);
  app.receive({ type: 'party-config', ...app.config, connected: false });
  assert.equal(app.video.paused, true);
});

test('host publishes controls and buffering pauses without guest feedback', async () => {
  const app = setup('host');
  await app.tick();
  app.video.paused = false;
  app.video.currentTime = 42;
  app.event('playing');
  let state = app.sent.filter(message => message.type === 'video-state').at(-1).state;
  assert.equal(state.position, 42);
  assert.equal(state.paused, false);
  app.event('waiting');
  state = app.sent.filter(message => message.type === 'video-state').at(-1).state;
  assert.equal(state.paused, true);
  app.event('playing');
  state = app.sent.filter(message => message.type === 'video-state').at(-1).state;
  assert.equal(state.paused, false);
});


test('Safari browser API reports its player and applies guest playback', async () => {
  const app = setup('guest', 'browser');
  await app.tick();
  assert.ok(app.sent.some(message => message.type === 'video-report'));
  app.state({ position: 250 });
  assert.equal(app.video.currentTime, 250);
  assert.equal(app.video.paused, false);
});
