import { animate, stagger } from 'motion';
import { tsParticles } from '@tsparticles/engine';
import { loadSlim } from '@tsparticles/slim';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const compactLayout = window.matchMedia('(max-width: 620px)');
const stageOrder = ['brief', 'render', 'approve', 'send', 'proof'];
const stageLabels = {
  brief: 'INTAKE / WAITING',
  render: 'FOXIT / RENDERING',
  approve: 'GATE / HUMAN REVIEW',
  send: 'ESIGN / DISPATCH READY',
  proof: 'PROOF / TERMINAL CHECK',
};

const board = document.querySelector('#provenance-board');
const routeMap = document.querySelector('.route-map');
const packet = document.querySelector('#route-packet');
const routeLabel = document.querySelector('#route-stage-label');
const scanBeam = document.querySelector('#scan-beam');
const paperWrap = document.querySelector('#paper-wrap');
const paper = document.querySelector('#paper');
const fingerprint = document.querySelector('#fingerprint');
const seal = document.querySelector('#approval-seal');
const signaturePath = document.querySelector('#signature-trace path');
let scanAnimation;
let currentStage = 'brief';

function nodeFor(stage) {
  return document.querySelector(`[data-route-stage="${stage}"]`);
}

function packetCoordinates(stage) {
  const node = nodeFor(stage);
  if (!node || !routeMap || !packet) return { x: 0, y: 0 };
  const mapRect = routeMap.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  return {
    x: nodeRect.left - mapRect.left + (nodeRect.width - packet.offsetWidth) / 2,
    y: nodeRect.top - mapRect.top + (nodeRect.height - packet.offsetHeight) / 2,
  };
}

function movePacket(stage, immediate = false) {
  if (!packet || compactLayout.matches) return;
  const target = packetCoordinates(stage);
  if (reducedMotion || immediate) {
    packet.style.transform = `translate(${target.x}px, ${target.y}px)`;
    return;
  }
  animate(packet, { x: target.x, y: target.y, rotate: [0, -3, 0] }, {
    duration: .48,
    ease: [0.22, 1, 0.36, 1],
  });
}

function setVisualStage(stage, immediate = false) {
  if (!stageOrder.includes(stage)) return;
  currentStage = stage;
  const current = stageOrder.indexOf(stage);
  if (board) board.dataset.state = stage;
  if (routeLabel) routeLabel.textContent = stageLabels[stage];
  document.querySelectorAll('[data-route-stage]').forEach((node) => {
    const index = stageOrder.indexOf(node.dataset.routeStage);
    node.classList.toggle('is-active', index === current);
    node.classList.toggle('is-done', index < current);
  });
  movePacket(stage, immediate);
  const activeNode = nodeFor(stage);
  if (activeNode && !reducedMotion && !immediate) {
    animate(activeNode, { scale: [.94, 1.04, 1] }, { duration: .34, ease: 'easeOut' });
  }
}

async function startParticles() {
  if (reducedMotion || compactLayout.matches || !document.querySelector('#provenance-particles')) return;
  await loadSlim(tsParticles);
  await tsParticles.load({
    id: 'provenance-particles',
    options: {
      fullScreen: { enable: false },
      background: { color: { value: 'transparent' } },
      detectRetina: true,
      fpsLimit: 30,
      pauseOnBlur: true,
      particles: {
        color: { value: ['#7cc1c1', '#ef5b3f', '#e7e7df'] },
        links: { enable: true, color: '#7cc1c1', distance: 92, opacity: .08, width: 1 },
        move: {
          enable: true,
          direction: 'right',
          random: true,
          speed: { min: .18, max: .6 },
          straight: false,
          outModes: { default: 'out' },
        },
        number: { value: 24, density: { enable: true, width: 900, height: 360 } },
        opacity: { value: { min: .12, max: .42 } },
        shape: { type: ['circle', 'square'] },
        size: { value: { min: 1, max: 2.8 } },
      },
      interactivity: { events: { onClick: { enable: false }, onHover: { enable: false }, resize: { enable: true } } },
    },
  });
}

function beginScan() {
  if (!paperWrap || !scanBeam) return;
  paperWrap.classList.add('is-scanning');
  if (reducedMotion) return;
  scanAnimation?.stop?.();
  const distance = Math.max(180, paperWrap.clientHeight - 66);
  scanAnimation = animate(scanBeam, { y: [0, distance, 0], opacity: [.35, 1, .35] }, {
    duration: 1.35,
    repeat: Infinity,
    ease: 'linear',
  });
}

function endScan() {
  if (typeof scanAnimation?.cancel === 'function') scanAnimation.cancel();
  else scanAnimation?.stop?.();
  scanAnimation = undefined;
  paperWrap?.classList.remove('is-scanning');
  const resetBeam = () => {
    if (!scanBeam) return;
    scanBeam.getAnimations().forEach((animation) => animation.cancel());
    scanBeam.style.opacity = '0';
    scanBeam.style.transform = 'translateY(0px)';
  };
  resetBeam();
  requestAnimationFrame(resetBeam);
}

function revealArtifact() {
  if (reducedMotion) return;
  if (paper) {
    animate(paper, { opacity: [0, 1], y: [28, 0], rotate: [.7, 0], scale: [.985, 1] }, {
      duration: .55,
      ease: [0.22, 1, 0.36, 1],
    });
  }
  const hashParts = fingerprint?.querySelectorAll('.hash-mark i, .hash-value, a');
  if (hashParts?.length) {
    animate(hashParts, { opacity: [0, 1], y: [8, 0] }, { delay: stagger(.055), duration: .25, ease: 'easeOut' });
  }
}

function stampApproval() {
  if (!seal || reducedMotion) return;
  animate(seal, { scale: [.72, 1.09, 1], rotate: [-14, 3, 0], opacity: [.35, 1] }, {
    duration: .48,
    ease: [0.22, 1, 0.36, 1],
  });
}

function showTamperBlock() {
  board?.classList.add('is-alert');
  if (reducedMotion || !board) return;
  animate(board, { x: [0, -8, 8, -5, 5, 0] }, { duration: .42, ease: 'easeInOut' });
  const result = document.querySelector('#gate-result.blocked');
  if (result) animate(result, { opacity: [0, 1], scale: [.98, 1] }, { duration: .24 });
}

function drawSignature() {
  if (!signaturePath) return;
  signaturePath.style.opacity = '1';
  if (reducedMotion) {
    signaturePath.style.strokeDasharray = 'none';
    return;
  }
  animate(signaturePath, { pathLength: [0, 1], opacity: [0, 1] }, { duration: .8, ease: 'easeInOut' });
}

window.addEventListener('signgate:stage', (event) => setVisualStage(event.detail.stage));
window.addEventListener('signgate:scan-start', beginScan);
window.addEventListener('signgate:scan-stop', endScan);
window.addEventListener('signgate:artifact', revealArtifact);
window.addEventListener('signgate:approved', stampApproval);
window.addEventListener('signgate:tampered', showTamperBlock);
window.addEventListener('signgate:final', drawSignature);

window.addEventListener('resize', () => movePacket(currentStage, true));
compactLayout.addEventListener('change', () => movePacket(currentStage, true));

setVisualStage('brief', true);
requestAnimationFrame(() => movePacket('brief', true));
startParticles().catch(() => {
  document.querySelector('#provenance-particles')?.setAttribute('hidden', '');
});
