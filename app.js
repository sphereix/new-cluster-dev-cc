/* clustercloud.uk Ã¢â‚¬â€ client behaviour. Part 2 of 3 (maths + topology). */

import { MARK_B64 } from './assets/mark-points.js'
import { CLOUD_B64 } from './assets/cloud-points.js'

/* ============================================================
   Small maths helpers
   ============================================================ */

function decodePoints(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

function markPoints() {
  return decodePoints(MARK_B64)
}

function cloudPoints() {
  return decodePoints(CLOUD_B64)
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fibSphere(i, n, radius) {
  const off = 2 / n
  const inc = Math.PI * (3 - Math.sqrt(5))
  const y = i * off - 1 + off / 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const phi = i * inc
  return [Math.cos(phi) * r * radius, y * radius, Math.sin(phi) * r * radius]
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a, b, t) => a + (b - a) * t
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt))

const dist2 = (a, b) => {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz
}

/* ============================================================
   Matrix maths (column-major, as WebGL wants it)
   ============================================================ */

function mat4() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2)
  out.fill(0)
  out[0] = f / aspect
  out[5] = f
  out[11] = -1
  const nf = 1 / (near - far)
  out[10] = (far + near) * nf
  out[14] = 2 * far * near * nf
  return out
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  v[0] /= l
  v[1] /= l
  v[2] /= l
  return v
}

function lookAt(out, eye, center, up) {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]])
  const x = normalize([
    up[1] * z[2] - up[2] * z[1],
    up[2] * z[0] - up[0] * z[2],
    up[0] * z[1] - up[1] * z[0]
  ])
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2])
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2])
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2])
  out[15] = 1
  return out
}

/**
 * Rotation about Y + per-axis scale, then translate Ã¢â‚¬â€ all an instanced rack needs.
 * Written column-major, which is what WebGL reads matrix attributes as.
 */
function compose(out, x, y, z, ry, sx, sy, sz) {
  const c = Math.cos(ry)
  const s = Math.sin(ry)
  // column 0
  out[0] = c * sx; out[1] = 0; out[2] = s * sz; out[3] = 0
  // column 1
  out[4] = 0; out[5] = sy; out[6] = 0; out[7] = 0
  // column 2
  out[8] = -s * sx; out[9] = 0; out[10] = c * sz; out[11] = 0
  // column 3 Ã¢â‚¬â€ translation
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1
  return out
}

/* ============================================================
   Cluster topology Ã¢â‚¬â€ deterministic, the same engineering as the source
   ============================================================ */

const CORE_RADIUS = 3.35

const QUALITY = {
  high: { coreCount: 46, hubCount: 8, edgeCount: 26, coreDegree: 3, dots: 560, linkSeg: 12, dprMax: 1.75, field: 11000 },
  medium: { coreCount: 32, hubCount: 7, edgeCount: 18, coreDegree: 3, dots: 320, linkSeg: 10, dprMax: 1.5, field: 6200 },
  low: { coreCount: 20, hubCount: 6, edgeCount: 12, coreDegree: 2, dots: 150, linkSeg: 8, dprMax: 1.25, field: 2800 }
}

function detectQuality() {
  const mobile = window.matchMedia('(max-width: 820px)').matches
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency || 4
  if (mobile || coarse) return cores >= 8 ? 'medium' : 'low'
  if (cores <= 4) return 'medium'
  return 'high'
}

function buildCluster(q) {
  const rnd = mulberry32(0x5eed1a7)

  /* ---------- core compute platform ---------- */
  const core = []
  for (let i = 0; i < q.coreCount; i++) {
    const v = fibSphere(i, q.coreCount, CORE_RADIUS)
    const m = 0.72 + rnd() * 0.36
    v[0] *= m
    v[1] *= m * 0.82
    v[2] *= m
    const size = 0.34 + Math.pow(rnd(), 1.4) * 0.62
    core.push({
      orbit: v.slice(),
      scale: [size, size * (0.46 + rnd() * 0.14), size * (0.72 + rnd() * 0.3)],
      ry: rnd() * Math.PI,
      phase: rnd() * Math.PI * 2,
      drift: 0.045 + rnd() * 0.075,
      load: rnd(),
      tier: 'core'
    })
  }

  /* ---------- service / hub layer ---------- */
  const hubs = []
  for (let i = 0; i < q.hubCount; i++) {
    const v = fibSphere(i, q.hubCount, 1)
    v[1] *= 0.5
    const len = Math.hypot(v[0], v[1], v[2]) || 1
    const m = (7.3 + rnd() * 1.5) / len
    v[0] *= m
    v[1] *= m * 0.85
    v[2] *= m
    const size = 0.24 + rnd() * 0.14
    hubs.push({
      orbit: v.slice(),
      scale: [size, size, size],
      ry: rnd() * Math.PI,
      phase: rnd() * Math.PI * 2,
      drift: 0.05 + rnd() * 0.08,
      load: 0.4,
      tier: 'hub'
    })
  }

  /* ---------- edge endpoints on the outer shell ---------- */
  const edge = []
  for (let i = 0; i < q.edgeCount; i++) {
    const v = fibSphere(i, q.edgeCount, 1)
    v[1] *= 0.72
    const len = Math.hypot(v[0], v[1], v[2]) || 1
    const m = (9.6 + rnd() * 2.2) / len
    v[0] *= m
    v[1] *= m * 0.9
    v[2] *= m
    edge.push({ orbit: v.slice(), phase: rnd() * Math.PI * 2, drift: 0.09 + rnd() * 0.14 })
  }

  const all = core.concat(hubs, edge)
  all.forEach((n, i) => (n.id = i))

  /* ---------- network graph ---------- */
  const pairs = []
  const seen = new Set()
  const add = (a, b, tier) => {
    if (a === b) return
    const key = a < b ? a + '-' + b : b + '-' + a
    if (seen.has(key)) return
    seen.add(key)
    pairs.push({ a, b, tier })
  }

  // hub <-> hub backbone
  for (let i = 0; i < hubs.length; i++) add(hubs[i].id, hubs[(i + 1) % hubs.length].id, 'backbone')

  // each hub anchors to two nearby core racks (kills any floaty look)
  hubs.forEach((h) => {
    core
      .slice()
      .sort((p, r) => dist2(p.orbit, h.orbit) - dist2(r.orbit, h.orbit))
      .slice(1, 3)
      .forEach((c) => add(h.id, c.id, 'spine'))
  })

  // core mesh
  core.forEach((c) => {
    core
      .filter((o) => o !== c)
      .sort((p, r) => dist2(p.orbit, c.orbit) - dist2(r.orbit, c.orbit))
      .slice(0, q.coreDegree)
      .forEach((o) => add(c.id, o.id, 'mesh'))
  })

  // endpoints attach to their nearest hub or core node
  edge.forEach((e) => {
    const near = hubs.concat(core).sort((p, r) => dist2(p.orbit, e.orbit) - dist2(r.orbit, e.orbit))[0]
    add(e.id, near.id, 'access')
  })

  /* ---------- line geometry with per-segment vertex data ---------- */
  const SEG = q.linkSeg
  const vertCount = pairs.length * SEG * 2
  const positions = new Float32Array(vertCount * 3)
  const aId = new Float32Array(vertCount)
  const bId = new Float32Array(vertCount)
  const t01 = new Float32Array(vertCount)
  const tierF = new Float32Array(vertCount)
  const lenF = new Float32Array(vertCount)
  const TIER = { backbone: 0.0, spine: 0.35, mesh: 0.6, access: 1.0 }

  pairs.forEach((p, li) => {
    const A = all[p.a].orbit
    const B = all[p.b].orbit

    // bowed link: the control point is pushed away from the cluster centre so
    // the graph reads as an engineered web rather than a wire cage. The bow is
    // a small fraction of the span Ã¢â‚¬â€ larger values turn the mesh into a scribble.
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2]
    const span = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2])
    const ol = Math.hypot(mid[0], mid[1], mid[2]) || 1
    const bow = (span * 0.14) / ol
    mid[0] += mid[0] * bow
    mid[1] += mid[1] * bow
    mid[2] += mid[2] * bow

    const pts = []
    let total = 0
    for (let k = 0; k <= SEG; k++) {
      const s = k / SEG
      const u = 1 - s
      const qx = u * u * A[0] + 2 * u * s * mid[0] + s * s * B[0]
      const qy = u * u * A[1] + 2 * u * s * mid[1] + s * s * B[1]
      const qz = u * u * A[2] + 2 * u * s * mid[2] + s * s * B[2]
      if (k > 0) {
        const prev = pts[k - 1]
        total += Math.hypot(qx - prev[0], qy - prev[1], qz - prev[2])
      }
      pts.push([qx, qy, qz])
    }

    for (let k = 0; k < SEG; k++) {
      // two vertices per segment, t = 0 at the head and t = 1 at the tail, so
      // aT interpolates cleanly along each independent segment
      for (let e2 = 0; e2 < 2; e2++) {
        const src = pts[e2 === 0 ? k : k + 1]
        const idx = li * SEG * 2 + k * 2 + e2
        positions[idx * 3] = src[0]
        positions[idx * 3 + 1] = src[1]
        positions[idx * 3 + 2] = src[2]
        aId[idx] = p.a
        bId[idx] = p.b
        t01[idx] = e2
        tierF[idx] = TIER[p.tier]
        lenF[idx] = total
      }
    }
  })

  /* ---------- instanced rack attributes ---------- */
  const racks = core.concat(hubs)
  const rackCount = racks.length
  const aPhase = new Float32Array(rackCount)
  const aLoad = new Float32Array(rackCount)
  const aDriftH = new Float32Array(rackCount)
  const aHighlight = new Float32Array(rackCount)
  const aSize = new Float32Array(rackCount * 3)
  const rackMatrices = new Float32Array(rackCount * 16)

  const tmp = mat4()
  racks.forEach((n, i) => {
    aPhase[i] = n.phase
    aLoad[i] = n.load
    aDriftH[i] = n.drift
    // relative prominence, 0..1: core racks read hottest, hubs sit mid, and the
    // node's own simulated load nudges it within its tier
    const base = n.tier === 'core' ? 0.75 : 0.4
    aHighlight[i] = base + n.load * (n.tier === 'core' ? 0.25 : 0.3)
    aSize[i * 3] = n.scale[0]
    aSize[i * 3 + 1] = n.scale[1]
    aSize[i * 3 + 2] = n.scale[2]
    compose(tmp, n.orbit[0], n.orbit[1], n.orbit[2], n.ry, 1, 1, 1)
    rackMatrices.set(tmp, i * 16)
  })

  /* ---------- point clouds: volume, accent, dust, stars ---------- */
  const cloud = (count, radiusFn, sizeFn, seed) => {
    const r = mulberry32(seed)
    const position = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const phase = new Float32Array(count)
    const bright = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const v = fibSphere(i, count, 1)
      const rad = radiusFn(r)
      position[i * 3] = v[0] * rad
      position[i * 3 + 1] = v[1] * rad * 0.78
      position[i * 3 + 2] = v[2] * rad
      size[i] = sizeFn(r)
      phase[i] = r() * Math.PI * 2
      bright[i] = 0.25 + Math.pow(r(), 1.6) * 0.95
    }
    return { position, size, phase, bright, count }
  }

  const volume = cloud(Math.round(q.dots * 0.62), (r) => 3.4 + Math.pow(r(), 0.72) * 5.4, (r) => 5 + r() * 14, 0xa11ce)
  const accent = cloud(Math.round(q.dots * 0.22), (r) => 2.2 + Math.pow(r(), 0.9) * 9.5, (r) => 3 + r() * 7, 0xb0b1e)
  const dust = cloud(q.dots, (r) => 6 + Math.pow(r(), 0.6) * 12, (r) => 1.6 + r() * 4.4, 0xc0ffee)
  const stars = cloud(Math.round(q.dots * 0.8), (r) => 66 + r() * 22, (r) => 2.2 + r() * 5.5, 0x51a75)

  return {
    core,
    hubs,
    edge,
    all,
    pairs,
    racks,
    lines: { positions, aId, bId, t01, tierF, lenF, count: vertCount },
    rack: { aPhase, aLoad, aDriftH, aHighlight, aSize, matrices: rackMatrices, count: rackCount },
    clouds: { volume, accent, dust, stars }
  }
}

/* ============================================================
   Shaders Ã¢â‚¬â€ the same three materials as the source project:
   rack blocks, the network graph with travelling pulses, and the
   soft point clouds. Written as line arrays so the escaping stays
   readable and no template literals are needed.
   ============================================================ */

const RACK_VERT = [
  'attribute vec3 position;',
  'attribute vec3 normal;',
  'attribute mat4 instanceMatrix;',
  'uniform mat4 uView;',
  'uniform mat4 uProj;',
  'uniform mat4 uModel;',
  'attribute vec3 aSize;',
  'attribute float aPhase;',
  'attribute float aLoad;',
  'attribute float aDrift;',
  'attribute float aHighlight;',
  'uniform float uTime;',
  'uniform float uExpand;',
  'uniform float uGrain;',
  'varying vec3 vNormal;',
  'varying vec3 vObj;',
  'varying float vPhase;',
  'varying float vLoad;',
  'varying float vHighlight;',
  'varying float vDepth;',
  'void main() {',
  '  vObj = position;',
  '  vNormal = mat3(instanceMatrix) * normal;',
  '  vPhase = aPhase;',
  '  vLoad = aLoad;',
  '  vHighlight = aHighlight;',
  '  vec3 transformed = position;',
  '  float front = abs(normal.z);',
  '  float p = abs(position.x) * 0.7 + abs(position.y) * 1.9;',
  '  transformed.z += front * 0.021 * smoothstep(0.0, 0.5, p);',
  '  float top = abs(normal.y);',
  '  transformed.y += top * 0.023 * step(0.5, abs(fract(p * 2.6) - 0.5)) * 1.6;',
  '  float s = uTime * 0.32 + aPhase;',
  '  vec3 drift = vec3(',
  '    sin(s * 1.13 + aDrift * 4.0),',
  '    cos(s * 0.87 + aDrift * 3.0),',
  '    sin(s * 0.71 + aDrift * 5.0)',
  '  ) * (0.055 + aDrift * 0.42);',
  '  float breathe = 1.0 + (0.5 + 0.5 * sin(uTime * 1.45 + aPhase * 2.3)) * 0.085 * aLoad;',
  '  float scaleUp = 1.0 + uExpand * 0.11;',
  '  vec3 local = (transformed + drift) * aSize * breathe * scaleUp * uGrain;',
  '  vec4 mv = uView * uModel * instanceMatrix * vec4(local, 1.0);',
  '  vDepth = -mv.z;',
  '  gl_Position = uProj * mv;',
  '}'
].join('\n')

const RACK_FRAG = [
  'precision highp float;',
  'uniform vec3 uBase;',
  'uniform vec3 uRim;',
  'uniform vec3 uAccent;',
  'uniform float uTime;',
  'uniform float uHighlight;',
  'varying vec3 vNormal;',
  'varying vec3 vObj;',
  'varying float vPhase;',
  'varying float vLoad;',
  'varying float vHighlight;',
  'varying float vDepth;',
  'void main() {',
  '  vec3 N = normalize(vNormal);',
  '  float facing = clamp(abs(N.z), 0.0, 1.0);',
  '  vec3 albedo = uBase;',
  '  float top = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);',
  '  vec3 keyDir = normalize(vec3(-0.45, 0.78, 0.44));',
  '  float key = clamp(dot(N, keyDir), 0.0, 1.0);',
  '  vec3 col = albedo * (1.05 + top * 1.35 + key * 2.2);',
  '  float brush = sin(vObj.y * 46.0 + vObj.x * 6.0) * 0.5 + 0.5;',
  '  col += albedo * brush * 0.05;',
  '  float rim = pow(1.0 - facing, 2.4);',
  '  col += uRim * rim * (1.15 + vHighlight * 1.5);',
  '  vec3 an = abs(N);',
  '  float side = 1.0 - smoothstep(0.0, 0.42, max(an.x, an.y));',
  '  float band = smoothstep(0.22, 0.3, abs(vObj.y)) * (1.0 - smoothstep(0.54, 0.62, abs(vObj.y)));',
  '  float blink = 0.35 + 0.65 * smoothstep(0.55, 1.0, sin(uTime * (0.9 + vLoad * 2.2) + vPhase * 5.0) * 0.5 + 0.5);',
  '  col += uAccent * side * band * blink * 0.9;',
  '  float vent = max(N.y, 0.0);',
  '  col += uAccent * vent * (0.16 + 0.22 * sin(uTime * 0.6 + vPhase));',
  '  col += uAccent * vHighlight * (0.28 + rim * 1.6) * uHighlight;',
  '  float fade = 1.0 - smoothstep(22.0, 40.0, vDepth);',
  '  if (fade < 0.01) discard;',
  '  gl_FragColor = vec4(col * fade * 0.18, fade);',
  '}'
].join('\n')

/* Morphing particle volume: the chain-link mark first, then the turning
   cube core from the loader mark, a bright-cored cloud, and the ring. Same
   orange family as the page. */
const FIELD_VERT = [
  'attribute vec4 aSeed;',
  'attribute vec2 aMark;',
  'attribute vec2 aCloud;',
  'uniform mat4 uView;',
  'uniform mat4 uProj;',
  'uniform mat4 uModel;',
  'uniform float uTime;',
  'uniform float uMorph;',
  'uniform float uMorphPrev;',
  'uniform float uPixelRatio;',
  'uniform float uAspect;',
  'uniform float uPass;',
  'uniform float uStreak;',
  'uniform float uLock;',
  'uniform vec2 uLockNdc;',
  'uniform float uLockPx;',
  'varying float vBright;',
  'varying float vDist;',
  'varying vec2 vVel;',
  'varying float vStretch;',
  'varying float vMark;',
  'varying float vIcon;',
  'varying float vCube;',
  'vec3 cubeSigns(float k) {',
  '  return vec3(',
  '    mod(k, 2.0) < 0.5 ? -1.0 : 1.0,',
  '    mod(floor(k / 2.0), 2.0) < 0.5 ? -1.0 : 1.0,',
  '    floor(k / 4.0) < 0.5 ? -1.0 : 1.0',
  '  );',
  '}',
  'vec3 coreAt(vec4 s, float time) {',
  '  float outer = 1.6;',
  '  float inner = 0.68 + 0.035 * sin(time * 1.4);',
  '  vec3 jit = (vec3(fract(s.z * 91.7), fract(s.z * 53.3), fract(s.w * 77.1)) - 0.5) * 0.09;',
  '  vec3 c;',
  '  if (s.w < 0.5) {',
  '    float e = floor(s.x * 12.0);',
  '    float axis = floor(e / 4.0);',
  '    float k = mod(e, 4.0);',
  '    float a = mod(k, 2.0) < 0.5 ? -1.0 : 1.0;',
  '    float b = k < 1.5 ? -1.0 : 1.0;',
  '    float t = s.y * 2.0 - 1.0;',
  '    if (axis < 0.5) c = vec3(t, a, b);',
  '    else if (axis < 1.5) c = vec3(a, t, b);',
  '    else c = vec3(a, b, t);',
  '    c = c * outer + jit;',
  '  } else if (s.w < 0.82) {',
  '    float face = floor(s.x * 6.0);',
  '    float side = mod(face, 2.0) < 0.5 ? -1.0 : 1.0;',
  '    float u = s.y * 2.0 - 1.0;',
  '    float v = s.z * 2.0 - 1.0;',
  '    if (face < 1.5) c = vec3(side, u, v);',
  '    else if (face < 3.5) c = vec3(u, side, v);',
  '    else c = vec3(u, v, side);',
  '    float fill = step(0.7, fract(s.x * 37.0));',
  '    c *= mix(1.0, 0.25 + 0.75 * fract(s.y * 29.0), fill);',
  '    c *= inner;',
  '  } else {',
  '    vec3 sg = cubeSigns(floor(s.x * 8.0));',
  '    float t = s.y;',
  '    c = sg * mix(inner, outer, t) + jit * 0.6;',
  '  }',
  '  float yaw = 0.7854 + time * 0.42;',
  '  float cy = cos(yaw);',
  '  float sy = sin(yaw);',
  '  c = vec3(cy * c.x + sy * c.z, c.y, -sy * c.x + cy * c.z);',
  '  float tilt = 0.6155;',
  '  float cx = cos(tilt);',
  '  float sx = sin(tilt);',
  '  c = vec3(c.x, cx * c.y - sx * c.z, sx * c.y + cx * c.z);',
  '  return c;',
  '}',
  'vec3 shapeAt(vec4 s, float time, float morph) {',
  '  float cycle = fract(morph * 0.068);',
  '  float x = cycle * 4.0;',
  '  float seg = floor(x);',
  '  float segU = x - seg;',
  '  float f = smoothstep(0.62, 1.0, segU);',
  '  float ang = s.x * 6.2831853;',
  '  float spin = time * 0.4;',
  '  float a = ang + spin * (0.32 + s.w * 0.45);',
  '  float tube = 0.12 + s.z * 0.7;',
  '  float radial = (s.y - 0.5) * 2.0;',
  '  float R = 4.5;',
  '  vec3 ring = vec3(',
  '    cos(a) * (R + radial * tube * 0.55),',
  '    sin(a) * (R + radial * tube * 0.55),',
  '    (s.z - 0.5) * 0.7',
  '  );',
  '  float y = s.y * 2.0 - 1.0;',
  '  float rr = sqrt(max(0.0, 1.0 - y * y));',
  '  float lobe = 0.46 + 0.8 * pow(0.5 + 0.5 * sin(ang * 2.0 + y * 2.5 + s.w * 5.2), 1.1);',
  '  float wob = 0.76 + 0.42 * sin(ang * 3.0 - time * 0.28 + s.z * 7.0);',
  '  float rc = (0.35 + pow(s.z, 0.52) * 4.4) * lobe * wob;',
  '  float ca = ang + spin * 0.12;',
  '  vec3 cloud = vec3(cos(ca) * rr * rc, y * rc * 0.68, sin(ca) * rr * rc);',
  '  float filament = smoothstep(0.7, 0.97, s.w);',
  '  vec3 cdir = cloud + vec3(0.001, 0.0, 0.001);',
  '  cdir = cdir / max(length(cdir), 0.001);',
  '  cloud = mix(cloud, cdir * (1.1 + s.z * 6.8), filament * 0.75);',
  '  vec2 mxy = aMark * 1.36;',
  '  float mc = uModel[0][0];',
  '  float ms = uModel[0][2];',
  '  float ml = max(length(vec2(mc, ms)), 0.001);',
  '  mc /= ml;',
  '  ms /= ml;',
  '  vec3 mark = vec3(mc * mxy.x, mxy.y, -ms * mxy.x);',
  '  vec3 core = coreAt(s, time);',
  '  vec3 p = mark;',
  '  vMark = 0.0;',
  '  vIcon = 0.0;',
  '  vCube = 0.0;',
  '  if (seg < 0.5) { p = mix(mark, core, f); vMark = 1.0 - f; vCube = f; }',
  '  else if (seg < 1.5) { p = mix(core, cloud, f); vCube = 1.0 - f; }',
  '  else if (seg < 2.5) {',
  '    p = mix(cloud, ring, f);',
  '    float burst = sin(f * 3.14159265);',
  '    vec3 dir = p + vec3(0.001, 0.0, 0.001);',
  '    dir = dir / max(length(dir), 0.001);',
  '    p += dir * burst * (0.7 + s.z * 1.2);',
  '  } else {',
  '    p = mix(ring, mark, f);',
  '    vMark = f;',
  '  }',
  '  return p;',
  '}',
  'vec2 markFlat(float time) {',
  '  vec2 m = aMark * 1.36;',
  '  m += vec2(sin(time * 0.55) * 0.02, sin(time * 0.7) * 0.025);',
  '  vec4 o = uProj * uView * uModel * vec4(0.0, 0.0, 0.0, 1.0);',
  '  vec4 up = uProj * uView * uModel * vec4(0.0, 1.0, 0.0, 1.0);',
  '  vec2 on = o.xy / max(o.w, 0.0001);',
  '  float k = up.y / max(up.w, 0.0001) - on.y;',
  '  return on + vec2(m.x * k / max(uAspect, 0.001), m.y * k);',
  '}',
  'vec2 iconFlat(float time) {',
  '  vec2 m = aCloud * 1.36;',
  '  m += vec2(sin(time * 0.48) * 0.018, sin(time * 0.62) * 0.02);',
  '  vec4 o = uProj * uView * uModel * vec4(0.0, 0.0, 0.0, 1.0);',
  '  vec4 up = uProj * uView * uModel * vec4(0.0, 1.0, 0.0, 1.0);',
  '  vec2 on = o.xy / max(o.w, 0.0001);',
  '  float k = up.y / max(up.w, 0.0001) - on.y;',
  '  return on + vec2(m.x * k / max(uAspect, 0.001), m.y * k);',
  '}',
  'void main() {',
  '  vec3 p = shapeAt(aSeed, uTime, uMorph);',
  '  float markNow = vMark;',
  '  float iconNow = vIcon;',
  '  float cubeNow = vCube;',
  '  vec3 prev = shapeAt(aSeed, uTime - 0.045, uMorphPrev);',
  '  float markPrev = vMark;',
  '  float iconPrev = vIcon;',
  '  float cubePrev = vCube;',
  '  float coreFace = step(0.5, aSeed.w) * step(aSeed.w, 0.82);',
  '  vCube = cubeNow * (1.0 - uLock);',
  '  vMark = mix(markNow, 1.0, uLock);',
  '  vIcon = mix(iconNow, 0.0, uLock);',
  '  float dist = length(p.xy);',
  '  float hot = smoothstep(6.6, 0.35, dist);',
  '  float bright = mix(0.55, 1.25, hot);',
  '  bright *= mix(0.72, 1.25, smoothstep(0.2, 0.98, aSeed.w));',
  '  bright *= mix(0.84 + 0.16 * sin(uTime * 1.6 + aSeed.x * 38.0), 1.0, uLock);',
  '  bright *= mix(1.0, 1.12, vMark);',
  '  bright *= mix(1.0, 0.62, vCube * coreFace);',
  '  vBright = bright;',
  '  vDist = dist;',
  '  vec4 mv = uView * uModel * vec4(p, 1.0);',
  '  float d = max(-mv.z, 0.35);',
  '  vec4 originMv = uView * uModel * vec4(0.0, 0.0, 0.0, 1.0);',
  '  d = mix(d, max(-originMv.z, 0.35), clamp(markNow + iconNow, 0.0, 1.0));',
  '  d = mix(d, max(-originMv.z, 0.35), uLock);',
  '  vec4 heroUp = uProj * uView * uModel * vec4(0.0, 1.0, 0.0, 1.0);',
  '  vec4 heroO = uProj * originMv;',
  '  float heroK = heroUp.y / max(heroUp.w, 0.0001) - heroO.y / max(heroO.w, 0.0001);',
  '  float lockScale = clamp(uLockPx / max(heroK, 0.0001), 0.2, 1.0);',
  '  vec4 clip = uProj * mv;',
  '  vec4 clip0 = uProj * uView * uModel * vec4(prev, 1.0);',
  '  vec2 ndc = clip.xy / max(clip.w, 0.0001);',
  '  vec2 ndc0 = clip0.xy / max(clip0.w, 0.0001);',
  '  float rest = clamp(1.0 - markNow - iconNow, 0.0, 1.0);',
  '  float rest0 = clamp(1.0 - markPrev - iconPrev, 0.0, 1.0);',
  '  ndc = ndc * rest + markFlat(uTime) * markNow + iconFlat(uTime) * iconNow;',
  '  ndc0 = ndc0 * rest0 + markFlat(uTime - 0.045) * markPrev + iconFlat(uTime - 0.045) * iconPrev;',
  '  vec2 cubeShift = vec2(0.44, 0.07) * smoothstep(1.0, 1.45, uAspect);',
  '  ndc += cubeShift * cubeNow;',
  '  ndc0 += cubeShift * cubePrev;',
  '  vec2 badge = uLockNdc + vec2(',
  '    aMark.x * 1.36 * uLockPx / max(uAspect, 0.001),',
  '    aMark.y * 1.36 * uLockPx',
  '  );',
  '  ndc = mix(ndc, badge, uLock);',
  '  ndc0 = mix(ndc0, badge, uLock);',
  '  clip.xy = ndc * clip.w;',
  '  vec2 vel = (ndc - ndc0) * vec2(uAspect, 1.0);',
  '  vVel = vel;',
  '  vStretch = clamp(1.0 + length(vel) * 14.0 * uStreak, 1.0, mix(2.6, 1.45, vMark));',
  '  vStretch = mix(vStretch, 1.0, max(uLock, vIcon));',
  '  float grain = mix(2.2, 5.2, aSeed.z);',
  '  grain = mix(grain, mix(1.55, 2.6, aSeed.z), vIcon);',
  '  float sz = grain * mix(1.0, 3.3, uPass);',
  '  sz *= mix(1.0, mix(1.18, 0.72, uPass), vMark);',
  '  sz *= mix(1.0, pow(lockScale, 0.8), uLock);',
  '  sz *= mix(1.0, mix(0.58, 0.28, uPass), vIcon);',
  '  sz *= uPixelRatio * (15.0 / d);',
  '  sz *= mix(0.75, 1.25, vBright);',
  '  sz *= mix(1.0, vStretch, 0.65);',
  '  gl_PointSize = clamp(sz, 1.0, 72.0);',
  '  gl_Position = clip;',
  '}'
].join('\n')

const FIELD_FRAG = [
  'precision highp float;',
  'uniform vec3 uCore;',
  'uniform vec3 uMid;',
  'uniform vec3 uEdge;',
  'uniform float uPass;',
  'uniform float uLock;',
  'uniform float uVis;',
  'varying float vBright;',
  'varying float vDist;',
  'varying vec2 vVel;',
  'varying float vStretch;',
  'varying float vMark;',
  'varying float vIcon;',
  'varying float vCube;',
  'void main() {',
  '  vec2 axis = vVel;',
  '  float sp = length(axis);',
  '  axis = sp > 0.00001 ? axis / sp : vec2(1.0, 0.0);',
  '  vec2 q = gl_PointCoord - 0.5;',
  '  float along = dot(q, axis);',
  '  float across = dot(q, vec2(-axis.y, axis.x));',
  '  float stretch = max(vStretch, 1.0);',
  '  float ex = (along * along) / (0.2 * stretch) + (across * across) / 0.045;',
  '  if (ex > 1.0) discard;',
  '  float a = exp(-ex * mix(3.2, 1.45, uPass) * mix(1.0, 1.2, vMark) * mix(1.0, 1.55, vIcon));',
  '  a *= clamp(vBright, 0.0, 1.35);',
  '  vec3 col = mix(uEdge, uMid, clamp(vBright, 0.0, 1.0));',
  '  col = mix(col, uCore, smoothstep(2.6, 0.25, vDist) * mix(0.8, 0.0, max(vMark, max(vIcon, vCube * 0.85))));',
  '  col = mix(col, uMid, max(vMark * 0.92, vIcon * 0.82));',
  '  col = mix(col, vec3(0.976, 0.42, 0.07), vCube * 0.7);',
  '  col = mix(col, vec3(0.976, 0.451, 0.086), uLock * 0.35);',
  '  float alpha = a * mix(0.58, 0.2, uPass);',
  '  alpha *= mix(1.0, mix(2.7, 1.45, uPass), vMark);',
  '  alpha *= mix(1.0, mix(1.45, 1.0, uPass), uLock);',
  '  alpha *= uVis;',
  '  gl_FragColor = vec4(col * alpha, alpha);',
  '}'
].join('\n')

const LINK_VERT = [
  'attribute vec3 position;',
  'uniform mat4 uView;',
  'uniform mat4 uProj;',
  'uniform mat4 uModel;',
  'attribute float aIdA;',
  'attribute float aIdB;',
  'attribute float aT;',
  'attribute float aTier;',
  'attribute float aLen;',
  'uniform float uCount;',
  'uniform float uSlot0;',
  'uniform float uSlot1;',
  'uniform float uSlot2;',
  'uniform float uSeed;',
  'varying float vT;',
  'varying float vTier;',
  'varying float vLen;',
  'varying float vPulse;',
  'varying float vDepth;',
  'float hash11(float p) {',
  '  p = fract(p * 0.1031);',
  '  p *= p + 33.33;',
  '  p *= p + p;',
  '  return fract(p);',
  '}',
  'void main() {',
  '  vT = aT;',
  '  vTier = aTier;',
  '  vLen = aLen;',
  '  float pulse = 0.0;',
  '  float len = max(aLen, 0.001);',
  '  for (int k = 0; k < 3; k++) {',
  '    float slot = (k == 0) ? uSlot0 : ((k == 1) ? uSlot1 : uSlot2);',
  '    if (slot < 0.0) continue;',
  '    float h0 = hash11(slot * 3.77 + uSeed);',
  '    float h1 = hash11(slot * 7.13 + uSeed + 11.0);',
  '    float h2 = hash11(slot * 5.51 + uSeed + 23.0);',
  '    for (int j = 0; j < 2; j++) {',
  '      float h = (j == 0) ? h0 : h1;',
  '      float a = mix(h2, h, 0.34 + h2 * 0.55);',
  '      float b = mix(h, h2, 0.18 + h0 * 0.5);',
  '      float ida = floor(a * uCount);',
  '      float idb = floor(b * uCount);',
  '      float prog = fract(h * 0.83 + uSeed * 0.19);',
  '      float tt = (j == 0) ? prog : 1.0 - prog;',
  '      float d = 1.0 - abs(((aT * (idb - ida) + ida) / uCount) - tt);',
  '      d = smoothstep(0.0, 0.052, d);',
  '      float w = d * min(1.6, 34.0 / len);',
  '      pulse = max(pulse, w);',
  '    }',
  '  }',
  '  vPulse = pulse;',
  '  vec4 mv = uView * uModel * vec4(position, 1.0);',
  '  vDepth = -mv.z;',
  '  gl_Position = uProj * mv;',
  '}'
].join('\n')

const LINK_FRAG = [
  'precision highp float;',
  'uniform vec3 uColor;',
  'uniform vec3 uPulseColor;',
  'uniform float uBaseOpacity;',
  'uniform float uPulseGain;',
  'varying float vT;',
  'varying float vTier;',
  'varying float vLen;',
  'varying float vPulse;',
  'varying float vDepth;',
  'void main() {',
  '  float tierGain = mix(1.0, 0.34, vTier);',
  '  float ends = smoothstep(0.0, 0.10, vT) * smoothstep(0.0, 0.10, 1.0 - vT);',
  '  float base = uBaseOpacity * tierGain * mix(0.28, 1.0, ends);',
  '  vec3 col = uColor;',
  '  float alpha = base;',
  '  float pulse = vPulse * uPulseGain;',
  '  if (pulse > 0.001) {',
  '    col = mix(uColor, uPulseColor, clamp(pulse, 0.0, 1.0));',
  '    alpha += pulse * (0.55 + smoothstep(0.72, 1.0, pulse) * 0.85);',
  '  }',
  '  float depthFade = 1.0 - smoothstep(26.0, 48.0, vDepth);',
  '  alpha *= depthFade;',
  '  if (alpha < 0.004) discard;',
  '  gl_FragColor = vec4(col * alpha, alpha);',
  '}'
].join('\n')

const CLOUD_VERT = [
  'attribute vec3 position;',
  'uniform mat4 uView;',
  'uniform mat4 uProj;',
  'uniform mat4 uModel;',
  'attribute float aSize;',
  'attribute float aPhase;',
  'attribute float aBright;',
  'uniform float uTime;',
  'uniform float uPixelRatio;',
  'uniform float uSizeScale;',
  'uniform float uAnimate;',
  'varying float vBright;',
  'varying float vDepth;',
  'varying float vTwinkle;',
  'void main() {',
  '  vec3 p = position;',
  '  if (uAnimate > 0.5) {',
  '    float s = uTime * 0.09;',
  '    p.x += sin(s * 1.7 + aPhase) * 0.42;',
  '    p.y += cos(s * 1.3 + aPhase * 1.7) * 0.34;',
  '    p.z += sin(s * 1.1 + aPhase * 2.3) * 0.42;',
  '  }',
  '  vec4 mv = uView * uModel * vec4(p, 1.0);',
  '  float d = -mv.z;',
  '  vDepth = d;',
  '  vBright = aBright;',
  '  vTwinkle = 0.72 + 0.28 * sin(uTime * (0.4 + aPhase * 0.25) + aPhase * 9.0);',
  '  gl_PointSize = aSize * uSizeScale * uPixelRatio * (18.0 / max(d, 0.35));',
  '  gl_PointSize = clamp(gl_PointSize, 0.6, 96.0);',
  '  gl_Position = uProj * mv;',
  '}'
].join('\n')

const CLOUD_FRAG = [
  'precision highp float;',
  'uniform vec3 uColor;',
  'uniform float uOpacity;',
  'varying float vBright;',
  'varying float vDepth;',
  'varying float vTwinkle;',
  'void main() {',
  '  vec2 c = gl_PointCoord - 0.5;',
  '  float r = dot(c, c);',
  '  if (r > 0.25) discard;',
  '  float a = 1.0 - smoothstep(0.0, 0.25, r);',
  '  a *= a;',
  '  float depthFade = 1.0 - smoothstep(30.0, 60.0, vDepth);',
  '  float alpha = a * uOpacity * vBright * vTwinkle * depthFade;',
  '  if (alpha < 0.003) discard;',
  '  gl_FragColor = vec4(uColor * alpha, alpha);',
  '}'
].join('\n')

const SOLID_VERT = [
  'attribute vec3 position;',
  'uniform mat4 uView;',
  'uniform mat4 uProj;',
  'uniform mat4 uModel;',
  'void main() {',
  '  gl_Position = uProj * uView * uModel * vec4(position, 1.0);',
  '}'
].join('\n')

const SOLID_FRAG = [
  'precision highp float;',
  'uniform vec3 uColor;',
  'uniform float uOpacity;',
  'void main() {',
  '  gl_FragColor = vec4(uColor * uOpacity, uOpacity);',
  '}'
].join('\n')

/* ============================================================
   GL plumbing
   ============================================================ */

function compile(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh))
  }
  return sh
}

function makeProgram(gl, vert, frag) {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p))
  }
  return p
}

function locations(gl, p, names) {
  const u = {}
  names.forEach((n) => (u[n] = gl.getUniformLocation(p, n)))
  return u
}

function makeBuffer(gl, data) {
  const b = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, b)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  return b
}

/* The instanced draw calls. WebGL2 has both entry points natively; WebGL1 only
   has them through ANGLE_instanced_arrays (aliased at context creation below).
   Calling one that does not exist throws inside the render loop and kills the
   whole scene, so every call site goes through these guards instead. */
function setDivisor(gl, loc, divisor) {
  if (!gl.vertexAttribDivisor) return
  gl.vertexAttribDivisor(loc, divisor)
}

function drawInstanced(gl, mode, count, type, offset, instances) {
  if (gl.drawElementsInstanced) {
    gl.drawElementsInstanced(mode, count, type, offset, instances)
    return
  }
  // Last resort: WebGL1 with no instancing extension. Un-instanced draw of the
  // same geometry, so the first rack lands in frame rather than nothing.
  if (offset && gl.drawElements) gl.drawElements(mode, count, type, offset)
}

function attrib(gl, loc, buf, size, stride, offset, divisor) {
  if (loc === null || loc === undefined || loc < 0) return
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride || 0, offset || 0)
  if (divisor) setDivisor(gl, loc, divisor)
}

function hex(h) {
  return [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255
  ]
}

/* ============================================================
   Camera choreography Ã¢â‚¬â€ one keyframe per story section
   ============================================================ */

/* One keyframe per section. The camera never cuts: between any two keys it
   travels a single continuous path (arc + dolly + bank, see CAM), so the whole
   page reads as one unbroken flight through the cluster rather than a series of
   cuts Ã¢â‚¬â€ the same way the reference clip moves. `dive` folds the camera inside
   the shell as the copy runs out, `open` swings the framing wide for the
   full-bleed bands, `bank` rolls the horizon. */
const STORY = [
  // 0 Ã¢â‚¬â€ hero: full cloud, left-weighted composition, opening wide
  { pos: [1.2, 0.5, 18.8], look: [0.15, 0.1, 0], fov: 34, spin: 0.055, link: 0.34, pulse: 1, highlight: 0, expand: 0, edge: 1, dive: 0, open: 0, bank: 0 },
  // 1 Ã¢â‚¬â€ what clustercloud does: dolly in a touch, let the copy speak
  { pos: [2.4, 1.4, 15.2], look: [0.4, 0, 0], fov: 34, spin: 0.075, link: 0.3, pulse: 0.8, highlight: 0.1, expand: 0, edge: 1, dive: 0.05, open: 0, bank: -0.04 },
  // 2 Ã¢â‚¬â€ managed infrastructure: move in on the core compute
  { pos: [4.6, 2.3, 9.4], look: [0.35, -0.25, 0], fov: 30, spin: 0.14, link: 0.42, pulse: 1.25, highlight: 1, expand: 0, edge: 1, dive: 0.2, open: 0, bank: 0.07 },
  // 3 Ã¢â‚¬â€ migration: three-quarter, watch the traffic come in
  { pos: [8.6, 3.4, 10.6], look: [0, 0, 0], fov: 33, spin: 0.24, link: 0.4, pulse: 2.0, highlight: 0.25, expand: 0, edge: 1, dive: 0.32, open: 0.04, bank: 0.18 },
  // 4 Ã¢â‚¬â€ monitoring: tight on the fleet, status lights hot
  { pos: [3.0, 4.4, 8.2], look: [0, 0.25, 0], fov: 29, spin: 0.2, link: 0.48, pulse: 1.6, highlight: 1.25, expand: 0, edge: 1, dive: 0.62, open: 0.08, bank: -0.12 },
  // 5 Ã¢â‚¬â€ enterprise services: pull back and let the edge open up
  { pos: [-7.8, 4.0, 20.2], look: [0, 0, 0], fov: 37, spin: -0.16, link: 0.34, pulse: 1.1, highlight: 0.45, expand: 0.15, edge: 1.16, dive: 0, open: 0.42, bank: -0.22 },
  // 6 Ã¢â‚¬â€ connectivity: sit wide and dim, let the endpoints carry it
  { pos: [-5.4, 3.0, 19.0], look: [0, 0, 0], fov: 39, spin: -0.1, link: 0.2, pulse: 0.9, highlight: 0.3, expand: 0.35, edge: 1.34, dive: 0, open: 0.76, bank: -0.09 },
  // 7 Ã¢â‚¬â€ resilience: structural expansion, mirrored fleet
  { pos: [-3.4, 2.2, 17.0], look: [0, 0.1, 0], fov: 35, spin: -0.06, link: 0.22, pulse: 0.7, highlight: 0.7, expand: 1, edge: 1, dive: 0, open: 0.14, bank: -0.05 },
  // 8 Ã¢â‚¬â€ why: wide, balanced, hero-composed
  { pos: [1.6, 1.6, 18.4], look: [0, 0, 0], fov: 36, spin: 0.05, link: 0.32, pulse: 1, highlight: 0.2, expand: 0.25, edge: 1, dive: 0, open: 0, bank: 0.03 }
]

/* Story sections Ã¢â‚¬â€ the ones the camera flies through. One keyframe each, in
   page order: hero Ã¢â€ â€™ what Ã¢â€ â€™ infrastructure Ã¢â€ â€™ migration Ã¢â€ â€™ monitoring Ã¢â€ â€™
   services Ã¢â€ â€™ connectivity Ã¢â€ â€™ resilience Ã¢â€ â€™ why. */
const STORY_IDS = [
  'hero', 'what', 'infrastructure', 'migration',
  'monitoring', 'services', 'connectivity', 'resilience', 'why'
]

/* How the camera travels, rather than where it stops. A single continuous
   flight: each leg is a catmull-rom arc through the neighbouring keys (so the
   path curves instead of kinking at every section), the eye dollies toward the
   look target as `dive` rises, `open` pushes the framing out, and `bank` rolls
   the horizon. No cuts anywhere Ã¢â‚¬â€ one move from hero to why. */
const CAM = {
  posSmooth: 0.6,   // 0 = straight lines between keys, 1 = fully curved flight path
  lookSmooth: 0.75, // the aim point leads the eye slightly through each turn
  diveDist: 7.2,    // how far inside the shell the eye travels at dive = 1
  diveTarget: 0.62, // ...and how much of the look target it inherits on the way
  openFov: 13,      // degrees of extra fov at open = 1
  openDist: 3.4,    // extra separation between eye and target at open = 1
  openLift: 1.5,    // the wide framing sits a little above the cluster
  bankMax: 0.28,    // radians of roll at bank = 1 Ã¢â‚¬â€ a lean, never a Dutch angle
  /* The copy needs somewhere to live. On a wide viewport the whole rig is
     pushed right and the aim point (and therefore the cluster) is carried with
     it, so the text column on the left stays clear of the blocks Ã¢â‚¬â€ including
     when the camera is inside the shell. Narrow viewports get no push: the
     copy sits over the stage and the scrim carries it. */
  pushX: 2.3,
  pushLook: 0.8
}

/* Centripetal-ish catmull-rom over a scalar series (the classic uniform form).
   Returns f(l) for l in [0,1] between knots i0 and i0+1. */
function camTrack(vals, i0, l, smooth) {
  const n = vals.length
  const g = (i) => vals[clamp(i, 0, n - 1)]
  const p0 = g(i0 - 1)
  const p1 = g(i0)
  const p2 = g(i0 + 1)
  const p3 = g(i0 + 2)
  const l2 = l * l
  const l3 = l2 * l
  const cr = 0.5 * ((2 * p1) + (-p0 + p2) * l + (2 * p0 - 5 * p1 + 4 * p2 - p3) * l2 + (-p0 + 3 * p1 - 3 * p2 + p3) * l3)
  return lerp(p1 + (p2 - p1) * l, cr, smooth)
}

/* The lookAt basis is built for an up vector of (0,1,0); rolling the horizon
   means tilting the camera's own up vector before it is handed over. */
function rollUp(roll, tmp) {
  const c = Math.cos(roll)
  const s = Math.sin(roll)
  tmp[0] = s
  tmp[1] = c
  tmp[2] = 0
  return tmp
}

/* ============================================================
   The cluster renderer
   ============================================================ */

function createCluster(canvas) {
  const ctxOpts = {
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  }
  // WebGL2 first: instanced rendering and vertexAttribDivisor are core there.
  // WebGL1 remains as a fallback with the ANGLE instanced-arrays extension.
  // `alpha: false` + `preserveDrawingBuffer` are valid attributes for both, but
  // the canvas refuses a second context request once one has been served, so
  // the fallback must reuse whatever context actually came back.
  let gl = canvas.getContext('webgl2', ctxOpts)
  if (!gl) {
    const names = ['webgl', 'webgl2', 'experimental-webgl']
    for (let i = 0; i < names.length && !gl; i++) {
      gl = canvas.getContext(names[i], ctxOpts)
    }
    if (gl) {
      const ext = gl.getExtension('ANGLE_instanced_arrays')
      if (ext) {
        gl.vertexAttribDivisor = ext.vertexAttribDivisorANGLE.bind(ext)
        gl.drawElementsInstanced = ext.drawElementsInstancedANGLE.bind(ext)
        gl.drawArraysInstanced = ext.drawArraysInstancedANGLE.bind(ext)
      }
    }
  }
  if (!gl) return null

  const quality = detectQuality()
  const q = QUALITY[quality]
  const cluster = buildCluster(q)

  /* ---------- rack geometry: unit box; front and back faces are subdivided
       in y so the LED band has vertices to live on ---------- */
  const boxVerts = []
  const boxNorms = []
  const boxIdx = []
  ;(function buildBox() {
    const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
    const push = (n, corners, subdiv) => {
      const base = boxVerts.length / 3
      const rows = subdiv ? 3 : 1
      for (let r = 0; r <= rows; r++) {
        const t = r / rows
        const left = lerp3(corners[0], corners[3], t)
        const right = lerp3(corners[1], corners[2], t)
        boxVerts.push(left[0], left[1], left[2], right[0], right[1], right[2])
        boxNorms.push(n[0], n[1], n[2], n[0], n[1], n[2])
      }
      for (let r = 0; r < rows; r++) {
        const i0 = base + r * 2
        boxIdx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3)
      }
    }
    const h = 0.5
    push([0, 0, 1], [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]], true)
    push([0, 0, -1], [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]], true)
    push([1, 0, 0], [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]], false)
    push([-1, 0, 0], [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]], false)
    push([0, 1, 0], [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]], false)
    push([0, -1, 0], [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]], false)
  })()

  /* ---------- programs ---------- */
  const rackProg = makeProgram(gl, RACK_VERT, RACK_FRAG)
  const rackU = locations(gl, rackProg, [
    'uTime', 'uExpand', 'uHighlight', 'uGrain', 'uBase', 'uRim', 'uAccent', 'uView', 'uProj', 'uModel'
  ])
  const rackA = {
    pos: gl.getAttribLocation(rackProg, 'position'),
    nor: gl.getAttribLocation(rackProg, 'normal'),
    inst: gl.getAttribLocation(rackProg, 'instanceMatrix'),
    size: gl.getAttribLocation(rackProg, 'aSize'),
    phase: gl.getAttribLocation(rackProg, 'aPhase'),
    load: gl.getAttribLocation(rackProg, 'aLoad'),
    drift: gl.getAttribLocation(rackProg, 'aDrift'),
    hl: gl.getAttribLocation(rackProg, 'aHighlight')
  }

  const linkProg = makeProgram(gl, LINK_VERT, LINK_FRAG)
  const linkU = locations(gl, linkProg, [
    'uCount', 'uSlot0', 'uSlot1', 'uSlot2', 'uSeed',
    'uBaseOpacity', 'uPulseGain', 'uColor', 'uPulseColor', 'uView', 'uProj', 'uModel'
  ])
  const linkA = {
    pos: gl.getAttribLocation(linkProg, 'position'),
    ida: gl.getAttribLocation(linkProg, 'aIdA'),
    idb: gl.getAttribLocation(linkProg, 'aIdB'),
    t: gl.getAttribLocation(linkProg, 'aT'),
    tier: gl.getAttribLocation(linkProg, 'aTier'),
    len: gl.getAttribLocation(linkProg, 'aLen')
  }

  const cloudProg = makeProgram(gl, CLOUD_VERT, CLOUD_FRAG)
  const cloudU = locations(gl, cloudProg, [
    'uTime', 'uPixelRatio', 'uSizeScale', 'uAnimate', 'uOpacity', 'uColor', 'uView', 'uProj', 'uModel'
  ])
  const cloudA = {
    pos: gl.getAttribLocation(cloudProg, 'position'),
    size: gl.getAttribLocation(cloudProg, 'aSize'),
    phase: gl.getAttribLocation(cloudProg, 'aPhase'),
    bright: gl.getAttribLocation(cloudProg, 'aBright')
  }

  const solidProg = makeProgram(gl, SOLID_VERT, SOLID_FRAG)
  const solidU = locations(gl, solidProg, ['uColor', 'uOpacity', 'uView', 'uProj', 'uModel'])
  const solidA = { pos: gl.getAttribLocation(solidProg, 'position') }

  const fieldProg = makeProgram(gl, FIELD_VERT, FIELD_FRAG)
  const fieldU = locations(gl, fieldProg, [
    'uTime', 'uMorph', 'uMorphPrev', 'uPixelRatio', 'uAspect', 'uPass', 'uStreak', 'uLock', 'uVis', 'uLockNdc', 'uLockPx', 'uCore', 'uMid', 'uEdge', 'uView', 'uProj', 'uModel'
  ])
  const fieldA = {
    seed: gl.getAttribLocation(fieldProg, 'aSeed'),
    mark: gl.getAttribLocation(fieldProg, 'aMark'),
    cloud: gl.getAttribLocation(fieldProg, 'aCloud')
  }
  const fieldCount = q.field
  const fieldSeed = (() => {
    const rnd = mulberry32(0x0e11a5)
    const data = new Float32Array(fieldCount * 4)
    for (let i = 0; i < fieldCount; i++) {
      data[i * 4] = rnd()
      data[i * 4 + 1] = rnd()
      data[i * 4 + 2] = rnd()
      data[i * 4 + 3] = rnd()
    }
    return makeBuffer(gl, data)
  })()
  const fieldMark = (() => {
    const rnd = mulberry32(0x0a11c0)
    const src = markPoints()
    const n = src.length / 2
    const order = new Uint32Array(n)
    for (let i = 0; i < n; i++) order[i] = i
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = order[i]
      order[i] = order[j]
      order[j] = t
    }
    const data = new Float32Array(fieldCount * 2)
    for (let i = 0; i < fieldCount; i++) {
      const k = order[i % n]
      data[i * 2] = src[k * 2]
      data[i * 2 + 1] = src[k * 2 + 1]
    }
    return makeBuffer(gl, data)
  })()
  const fieldCloud = (() => {
    const rnd = mulberry32(0xc10ed)
    const src = cloudPoints()
    const n = src.length / 2
    const order = new Uint32Array(n)
    for (let i = 0; i < n; i++) order[i] = i
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = order[i]
      order[i] = order[j]
      order[j] = t
    }
    const data = new Float32Array(fieldCount * 2)
    for (let i = 0; i < fieldCount; i++) {
      const k = order[i % n]
      data[i * 2] = src[k * 2]
      data[i * 2 + 1] = src[k * 2 + 1]
    }
    return makeBuffer(gl, data)
  })()

  /* ---------- buffers ---------- */
  const rack = cluster.rack
  const vbo = {
    boxPos: makeBuffer(gl, new Float32Array(boxVerts)),
    boxNor: makeBuffer(gl, new Float32Array(boxNorms)),
    inst: makeBuffer(gl, rack.matrices),
    aSize: makeBuffer(gl, rack.aSize),
    aPhase: makeBuffer(gl, rack.aPhase),
    aLoad: makeBuffer(gl, rack.aLoad),
    aDrift: makeBuffer(gl, rack.aDriftH),
    aHighlight: makeBuffer(gl, rack.aHighlight)
  }
  const boxIdxBuf = (() => {
    const b = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(boxIdx), gl.STATIC_DRAW)
    return b
  })()

  const lines = cluster.lines
  const lvbo = {
    pos: makeBuffer(gl, lines.positions),
    ida: makeBuffer(gl, lines.aId),
    idb: makeBuffer(gl, lines.bId),
    t: makeBuffer(gl, lines.t01),
    tier: makeBuffer(gl, lines.tierF),
    len: makeBuffer(gl, lines.lenF)
  }

  const cloudBuf = {}
  const addCloud = (key, spec) => {
    cloudBuf[key] = {
      pos: makeBuffer(gl, spec.position),
      size: makeBuffer(gl, spec.size),
      phase: makeBuffer(gl, spec.phase),
      bright: makeBuffer(gl, spec.bright),
      count: spec.count
    }
  }
  addCloud('volume', cluster.clouds.volume)
  addCloud('accent', cluster.clouds.accent)
  addCloud('dust', cluster.clouds.dust)
  addCloud('stars', cluster.clouds.stars)

  const edgeN = cluster.edge.length
  const edgePos = new Float32Array(edgeN * 3)
  cluster.edge.forEach((n, i) => {
    edgePos[i * 3] = n.orbit[0]
    edgePos[i * 3 + 1] = n.orbit[1]
    edgePos[i * 3 + 2] = n.orbit[2]
  })
  addCloud('edge', {
    position: edgePos,
    size: new Float32Array(edgeN).fill(0.19),
    phase: new Float32Array(cluster.edge.map((n) => n.phase)),
    bright: new Float32Array(edgeN).fill(1),
    count: edgeN
  })

  /* ---------- service rings ---------- */
  const ringBuf = (() => {
    const N = 128
    const verts = new Float32Array(N * 2 * 3)
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2
      const a1 = ((i + 1) / N) * Math.PI * 2
      verts[i * 6] = Math.cos(a0)
      verts[i * 6 + 1] = Math.sin(a0)
      verts[i * 6 + 2] = 0
      verts[i * 6 + 3] = Math.cos(a1)
      verts[i * 6 + 4] = Math.sin(a1)
      verts[i * 6 + 5] = 0
    }
    return { buf: makeBuffer(gl, verts), count: N * 2 }
  })()

  /* ---------- mirrored redundancy shell (resilience section) ---------- */
  const shellMatrices = new Float32Array(cluster.core.length * 16)
  const sm = mat4()
  cluster.core.forEach((n, i) => {
    const m = 1.34 + n.load * 0.1
    const s = 0.5 + n.load * 0.24
    compose(sm, n.orbit[0] * m, n.orbit[1] * m, n.orbit[2] * m, n.ry, s, s, s)
    shellMatrices.set(sm, i * 16)
  })
  const shellBuf = makeBuffer(gl, shellMatrices)

  /* ---------- state ---------- */
  const state = {
    pos: STORY[0].pos.slice(),
    look: STORY[0].look.slice(),
    fov: STORY[0].fov,
    camY: 0,
    spin: 0,
    shift: 0,
    highlight: 0,
    expand: 0,
    link: 0,
    pulse: 1,
    edgeScale: 1,
    bank: 0,
    dive: 0,
    open: 0,
    aspect: 1,
    wide: true,
    dpr: 1,
    lock: 0,
    lockNdc: [0, 0.2],
    lockPx: 0.02,
    cube: 0,
    pin: null,
    vis: 1,
    slot: 0
  }

  /* The keyframe track, flattened per component once, so the flight path is a
     handful of scalar lookups per frame rather than object churn. */
  const posTrack = [0, 1, 2].map((k) => STORY.map((s) => s.pos[k]))
  const lookTrack = [0, 1, 2].map((k) => STORY.map((s) => s.look[k]))
  const diveTrack = STORY.map((s) => s.dive || 0)
  const openTrack = STORY.map((s) => s.open || 0)
  const bankTrack = STORY.map((s) => s.bank || 0)
  const keyTrack = {
    fov: STORY.map((s) => s.fov),
    spin: STORY.map((s) => s.spin),
    link: STORY.map((s) => s.link),
    pulse: STORY.map((s) => s.pulse),
    highlight: STORY.map((s) => s.highlight),
    expand: STORY.map((s) => s.expand),
    edge: STORY.map((s) => s.edge)
  }
  const camA = [0, 0, 0]
  const camB = [0, 0, 0]
  const upTmp = [0, 1, 0]

  const view = mat4()
  const proj = mat4()
  const model = mat4()
  const eye = [0, 0, 16]

  const scroll = { progress: 0, story: 0, }
  const pricingHead = document.querySelector('#pricing h2')
  const afterPricing = document.getElementById('why')
  const MARK_SPAN = 7.166 * 1.36
  const MOBILE_DROP = 0.2

  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0 || 1), 0, 1)
    return t * t * (3 - 2 * t)
  }

  // NDC position of a world point under the current view and projection
  const ndcTmp = [0, 0]
  function ndcAt(x, y, z, out) {
    const vx = view[0] * x + view[4] * y + view[8] * z + view[12]
    const vy = view[1] * x + view[5] * y + view[9] * z + view[13]
    const vz = view[2] * x + view[6] * y + view[10] * z + view[14]
    const vw = view[3] * x + view[7] * y + view[11] * z + view[15]
    const cx = proj[0] * vx + proj[4] * vy + proj[8] * vz + proj[12] * vw
    const cy = proj[1] * vx + proj[5] * vy + proj[9] * vz + proj[13] * vw
    const cw = proj[3] * vx + proj[7] * vy + proj[11] * vz + proj[15] * vw
    const w = Math.abs(cw) > 1e-6 ? cw : 1e-6
    out[0] = cx / w
    out[1] = cy / w
    return out
  }

  /* While the pricing heading is the section on screen, the field settles
     into a small logo sitting above it. Leaving into the next section
     releases it back to the travelling morph. */
  function pricingBadge() {
    if (!pricingHead || !afterPricing) return { t: 0, x: 0, y: 0.2, px: 0.02 }
    const hr = pricingHead.getBoundingClientRect()
    const nr = afterPricing.getBoundingClientRect()
    const vh = window.innerHeight
    const vw = window.innerWidth
    const arrive = smoothstep(vh * 1.05, vh * 0.6, hr.top)
    const hold = smoothstep(vh * 0.24, vh * 0.62, nr.top)
    const logoH = clamp(Math.min(vh * 0.3, vw * 0.22), 150, 260)
    const cx = hr.left + hr.width * 0.5
    const cy = hr.top - 22 - logoH * 0.5
    return {
      t: arrive * hold,
      x: (cx / vw) * 2 - 1,
      y: 1 - (cy / vh) * 2,
      px: (logoH / vh) * 2 / MARK_SPAN
    }
  }
  /* Scroll-directed scenes below the hero. Each scene parks the morph on one
     shape and pins it in place while its copy is on screen:
       Cluster Group intro      -> cube, drawn into its slot beside the
                                   heading so it cannot drop into the cards
       What ClusterCloud does   -> mist, once that heading reaches the top,
                                   held through infrastructure, migration
                                   and monitoring until the services section
       Enterprise services      -> cube, drawn into its slot beside the
                                   heading so it scrolls with the section
       Connectivity             -> mist, held until resilience */
  const familyHead = document.querySelector('#what .section-head')
  const whatHead = document.querySelector('#what .family-follow')
  const svcHead = document.querySelector('#services .section-head')
  const familySlot = document.getElementById('familyCubeSlot')
  const cubeSlot = document.getElementById('svcCubeSlot')
  const connEl = document.getElementById('connectivity')
  const resEl = document.getElementById('resilience')
  const MORPH_PERIOD = 1 / 0.068
  const MARK_PHASE = 0
  const CUBE_PHASE = 0.31 * MORPH_PERIOD
  const MIST_PHASE = 0.58 * MORPH_PERIOD
  const CUBE_RADIUS = 2.6
  const rootStyle = document.documentElement.style
  let glowShown = ''
  let veilShown = ''
  let lastSlotEl = null
  const NO_SCENE = { t: 0, dark: 0, phase: MARK_PHASE, progress: 0, slot: null }

  function scrollScene() {
    if (!familyHead || !whatHead || !svcHead || !connEl || !resEl) return NO_SCENE
    const vh = window.innerHeight
    const max = Math.max(1, document.documentElement.scrollHeight - vh)
    const pinAt = (top, at) => clamp((window.scrollY + top - vh * at) / max, 0, 1)

    const famTop = familyHead.getBoundingClientRect().top
    const whatTop = whatHead.getBoundingClientRect().top
    const svcTop = svcHead.getBoundingClientRect().top

    // mist waits until "What ClusterCloud does" is at the top of the frame
    const intoWhat = 1 - smoothstep(vh * 0.08, vh * 0.36, whatTop)
    const intoSvc = smoothstep(vh * 1.0, vh * 0.55, svcTop)

    const cubeA = smoothstep(vh * 1.0, vh * 0.55, famTop) * (1 - intoWhat)
    const dark = 0
    const mist = intoWhat * (1 - intoSvc)
    const connTop = connEl.getBoundingClientRect().top
    const intoConn = 1 - smoothstep(vh * 0.5, vh * 0.85, connTop)
    const intoRes = 1 - smoothstep(vh * 0.5, vh * 0.85, resEl.getBoundingClientRect().top)
    const cubeB = intoSvc * (1 - intoConn)
    const mistB = intoConn * (1 - intoRes)

    const t = Math.max(cubeA, dark, mist, cubeB, mistB)
    if (t < 0.001) {
      return { t: 0, dark: 0, phase: MARK_PHASE, progress: 0, slot: null }
    }
    if (cubeB >= t && cubeB > 0) {
      return { t, dark, phase: CUBE_PHASE, progress: pinAt(svcTop, 0.2), slot: cubeSlot }
    }
    if (mistB >= t && mistB > 0) {
      return { t, dark, phase: MIST_PHASE, progress: pinAt(connTop, 0.3), slot: null }
    }
    if (cubeA > 0 && cubeA >= Math.max(dark, mist)) {
      return { t, dark, phase: CUBE_PHASE, progress: pinAt(famTop, 0.45), slot: familySlot }
    }
    return { t, dark, phase: MIST_PHASE, progress: pinAt(whatTop, 0.7), slot: null }
  }

  let ready = false
  let packetSlot = 0
  let packetTimer = 0
  let elapsed = 0
  let morph = 0
  let morphRate = 1
  let heroReset = false

  /* ---------- scroll ---------- */
  const storyEls = STORY_IDS.map((id) => document.getElementById(id))

  function readScroll() {
    const doc = document.documentElement
    const max = Math.max(1, doc.scrollHeight - window.innerHeight)
    scroll.progress = clamp(window.scrollY / max, 0, 1)

    const lastEl = storyEls[storyEls.length - 1]
    if (!lastEl) return
    const lastTop = lastEl.offsetTop - window.innerHeight * 0.4
    scroll.story = clamp(window.scrollY / Math.max(1, lastTop), 0, 1)
  }

  window.addEventListener('scroll', readScroll, { passive: true })
  window.addEventListener('resize', readScroll)
  readScroll()

  /* ---------- resize ---------- */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, q.dprMax)
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    const nw = Math.round(w * dpr)
    const nh = Math.round(h * dpr)
    if (canvas.width !== nw || canvas.height !== nh) {
      canvas.width = nw
      canvas.height = nh
    }
    gl.viewport(0, 0, nw, nh)
    state.aspect = w / Math.max(1, h)
    state.wide = w > 900
    state.dpr = dpr
  }
  window.addEventListener('resize', resize)
  resize()

  /* ---------- instanced attribute binding (a 4x4 matrix is four vec4 slots) ---------- */
  function bindRackAttributes(matBuf) {
    attrib(gl, rackA.pos, vbo.boxPos, 3)
    attrib(gl, rackA.nor, vbo.boxNor, 3)
    for (let k = 0; k < 4; k++) {
      const loc = rackA.inst + k
      gl.bindBuffer(gl.ARRAY_BUFFER, matBuf)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, k * 16)
      setDivisor(gl, loc, 1)
    }
    attrib(gl, rackA.size, vbo.aSize, 3, 0, 0, 1)
    attrib(gl, rackA.phase, vbo.aPhase, 1, 0, 0, 1)
    attrib(gl, rackA.load, vbo.aLoad, 1, 0, 0, 1)
    attrib(gl, rackA.drift, vbo.aDrift, 1, 0, 0, 1)
    attrib(gl, rackA.hl, vbo.aHighlight, 1, 0, 0, 1)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, boxIdxBuf)
  }

  /* ---------- render loop ---------- */
  let last = performance.now()

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30)
    last = now
    if (ready) elapsed += dt
    const t = elapsed

    const scene = scrollScene()
    state.cube = damp(state.cube, scene.t, 3, dt)
    state.pin = damp(state.pin == null ? scene.progress : state.pin, scene.progress, 2.4, dt)
    state.vis = damp(state.vis, 1 - scene.dark, 2.6, dt)
    const glow = state.vis.toFixed(3)
    const veil = (0.3 + 0.7 * state.vis).toFixed(3)
    if (glow !== glowShown || veil !== veilShown) {
      rootStyle.setProperty('--glow', glow)
      rootStyle.setProperty('--veil', veil)
      glowShown = glow
      veilShown = veil
    }
    if (ready && dt > 0) {
      const before = morph
      const P = MORPH_PERIOD
      const atHero = scene.t < 0.05
      if (!atHero) heroReset = true
      const wrapPos = () => ((morph % P) + P) % P
      let snapped = false
      const landOnMark = () => {
        morph -= wrapPos()
        heroReset = false
        snapped = true
      }
      morph += dt * (1 - state.cube)
      if (state.cube > 0.001 && scene.phase !== MARK_PHASE) {
        const gap = ((((scene.phase - morph + P / 2) % P) + P) % P) - P / 2
        morph += gap * (1 - Math.exp(-dt * 2.4 * state.cube))
      } else if (atHero && heroReset) {
        // sit on the cluster immediately — do not run the rest of the cycle to get there
        const pos = wrapPos()
        if (pos > 0.02 && pos <= CUBE_PHASE + 0.12) {
          morph += -pos * (1 - Math.exp(-dt * 2.2))
          if (wrapPos() < 0.05) landOnMark()
        } else {
          landOnMark()
        }
      }
      morphRate = snapped ? 0 : clamp((morph - before) / dt, -4, 4)
    }

    /* Camera stays on the hero shot. The stage itself scrolls with the page,
       so the animation does not fly into a new angle as the copy moves on. */
    const storyPos = 0
    const i0 = Math.min(STORY.length - 1, Math.floor(storyPos))
    const i1 = Math.min(STORY.length - 1, i0 + 1)
    const l = clamp(storyPos - i0, 0, 1)
    const e = l * l * (3 - 2 * l) // slow-in / slow-out along the leg itself

    // curved path through the keys, so a leg bends away from a straight line
    // between two sections rather than kinking at each one
    const mix = (key) => camTrack(keyTrack[key], i0, e, 0.6)
    for (let k = 0; k < 3; k++) {
      camA[k] = camTrack(posTrack[k], i0, e, CAM.posSmooth)
      camB[k] = camTrack(lookTrack[k], i0, e, CAM.lookSmooth)
    }

    // dive: the eye keeps moving after the look target has settled, so the
    // cluster falls away behind the copy instead of the shot cutting out
    const dive = camTrack(diveTrack, i0, e, 0.5)
    const open = camTrack(openTrack, i0, e, 0.5)

    for (let k = 0; k < 3; k++) {
      camA[k] += (camB[k] - camA[k]) * (dive * CAM.diveTarget + open * 0.5)
    }

    // open: lift the wide framing and hold the eye back from the subject
    camA[1] += open * CAM.openLift
    camB[1] += open * CAM.openLift * 0.4

    // on a wide viewport the whole rig rides right, so the copy column on the
    // left keeps a clear side even while the camera is inside the shell
    const push = state.wide ? CAM.pushX : 0

    state.pos[0] = damp(state.pos[0], camA[0] + push, 1.5, dt)
    state.pos[1] = damp(state.pos[1], camA[1] + state.camY, 1.25, dt)
    state.pos[2] = damp(state.pos[2], camA[2], 1.5, dt)
    state.look[0] = damp(state.look[0], camB[0] + push * CAM.pushLook, 1.4, dt)
    state.look[1] = damp(state.look[1], camB[1], 1.4, dt)
    state.look[2] = damp(state.look[2], 0, 1.4, dt)

    // roll the horizon a few degrees through the turns Ã¢â‚¬â€ the single strongest
    // cue that the camera is flying rather than being cut between angles
    state.bank = damp(state.bank, camTrack(bankTrack, i0, e, 0.5) * CAM.bankMax, 1.35, dt)
    state.dive = dive
    state.open = open

    state.fov = damp(
      state.fov,
      (mix('fov') + open * CAM.openFov) * (state.aspect < 0.95 ? 1.22 : 1),
      1.6,
      dt
    )
    state.highlight = damp(state.highlight, mix('highlight'), 1.6, dt)
    state.expand = damp(state.expand, mix('expand'), 1.5, dt)
    state.link = damp(state.link, mix('link'), 1.6, dt)
    state.pulse = damp(state.pulse, mix('pulse'), 1.6, dt)
    state.edgeScale = damp(state.edgeScale, mix('edge'), 1.5, dt)

    // continuous slow rotation + scroll-driven turn
    state.spin += dt * mix('spin') * 0.09
    // on desktop the cluster sits right of centre so the headline owns the left
    state.shift = damp(state.shift, state.wide ? 1.6 : 0, 1.2, dt)

    let groupX = state.shift
    // Lift the volume with the page so it travels beside the copy, and keep
    // it inside the frame so later sections are not an empty ground.
    const lift = lerp(scroll.progress, state.pin, state.cube)
    // portrait screens: shrink the volume to the width and sit it lower, in the
    // open band between the hero copy and the facts strip
    const narrow = clamp((0.95 - state.aspect) / 0.45, 0, 1)
    state.fit = damp(state.fit == null ? 1 - narrow * 0.58 : state.fit, 1 - narrow * 0.58, 2, dt)
    let groupY = Math.sin(now * 0.00021) * 0.16 + lift * 3.2 - narrow * MOBILE_DROP
    const badge = pricingBadge()
    state.lock = damp(state.lock, badge.t, 3.6, dt)
    state.lockNdc[0] = badge.x
    state.lockNdc[1] = badge.y
    state.lockPx = badge.px
    // the cluster itself opens slightly as the flight goes inside it
    let openScale = (1 + dive * 0.14 + open * CAM.openDist * 0.1) * state.fit

    eye[0] = state.pos[0]
    eye[1] = state.pos[1]
    eye[2] = state.pos[2]

    /* --- frame --- */
    gl.clearColor(0.031, 0.024, 0.02, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)

    perspective(proj, (state.fov * Math.PI) / 180, state.aspect, 0.5, 220)
    lookAt(view, eye, state.look, rollUp(state.bank, upTmp))
    // cube scenes draw into a page slot so the volume scrolls with its
    // heading and cannot drift down into the cards below
    if (scene.slot) lastSlotEl = scene.slot
    const activeSlot = scene.slot || (state.slot > 0.001 ? lastSlotEl : null)
    state.slot = damp(state.slot, scene.slot ? 1 : 0, 4, dt)
    const slotRect = activeSlot && state.slot > 0.001 ? activeSlot.getBoundingClientRect() : null
    if (slotRect && slotRect.height > 10) {
      const vw = canvas.clientWidth || window.innerWidth
      const vh = canvas.clientHeight || window.innerHeight
      const sh = smoothstep(1.0, 1.45, state.aspect)
      const toPx = (x, y) => {
        ndcAt(x, y, 0, ndcTmp)
        return [(ndcTmp[0] + 0.44 * sh + 1) * 0.5 * vw, (1 - (ndcTmp[1] + 0.07 * sh)) * 0.5 * vh]
      }
      const k = state.slot
      const top = toPx(groupX, groupY + CUBE_RADIUS * openScale)
      const bottom = toPx(groupX, groupY - CUBE_RADIUS * openScale)
      const fit = clamp(slotRect.height / Math.max(bottom[1] - top[1], 1), 0.3, 1.6)
      openScale *= lerp(1, fit, k)
      const start = toPx(groupX, groupY)
      const goalX = lerp(start[0], slotRect.left + slotRect.width * 0.5, k)
      const goalY = lerp(start[1], slotRect.top + slotRect.height * 0.5, k)
      for (let i = 0; i < 3; i++) {
        const c = toPx(groupX, groupY)
        const dx = toPx(groupX + 1, groupY)[0] - c[0]
        const dy = toPx(groupX, groupY + 1)[1] - c[1]
        if (Math.abs(dx) > 0.01) groupX += (goalX - c[0]) / dx
        if (Math.abs(dy) > 0.01) groupY += (goalY - c[1]) / dy
      }
    }
    compose(model, groupX, groupY, 0, state.spin, openScale, openScale, openScale)

    const dpr = state.dpr || 1

    /* ================= point clouds ================= */
    gl.useProgram(cloudProg)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE) // additive
    gl.depthMask(false)
    gl.uniformMatrix4fv(cloudU.uView, false, view)
    gl.uniformMatrix4fv(cloudU.uProj, false, proj)
    gl.uniformMatrix4fv(cloudU.uModel, false, model)

    const drawPoints = (key, color, opacity, sizeScale, animate, time, pixelBoost) => {
      const b = cloudBuf[key]
      gl.uniform1f(cloudU.uSizeScale, sizeScale)
      gl.uniform1f(cloudU.uAnimate, animate)
      gl.uniform1f(cloudU.uOpacity, opacity)
      gl.uniform1f(cloudU.uTime, time)
      gl.uniform1f(cloudU.uPixelRatio, dpr * (pixelBoost || 1))
      gl.uniform3fv(cloudU.uColor, color)
      attrib(gl, cloudA.pos, b.pos, 3)
      attrib(gl, cloudA.size, b.size, 1)
      attrib(gl, cloudA.phase, b.phase, 1)
      attrib(gl, cloudA.bright, b.bright, 1)
      gl.drawArrays(gl.POINTS, 0, b.count)
    }

    const calm = (1 - state.lock) * (0.25 + 0.75 * state.vis)
    drawPoints('stars', hex('#f6e3d2'), 0.28 * calm, 0.55, 0, t * 0.25)
    drawPoints('dust', hex('#f08a3c'), 0.1 * calm, 0.55, 1, t * 0.8)
    // client / device endpoints, opening up in the services section
    drawPoints('edge', hex('#fdba74'), 0.7 * calm * state.vis, 0.55, 0, t, state.edgeScale)

    /* ================= morphing particle volume ================= */
    gl.disable(gl.DEPTH_TEST)
    gl.depthMask(false)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.useProgram(fieldProg)
    gl.uniformMatrix4fv(fieldU.uView, false, view)
    gl.uniformMatrix4fv(fieldU.uProj, false, proj)
    gl.uniformMatrix4fv(fieldU.uModel, false, model)
    gl.uniform1f(fieldU.uTime, t)
    gl.uniform1f(fieldU.uMorph, morph)
    gl.uniform1f(fieldU.uMorphPrev, morph - morphRate * 0.045)
    gl.uniform1f(fieldU.uPixelRatio, dpr)
    gl.uniform1f(fieldU.uAspect, state.aspect)
    gl.uniform1f(fieldU.uStreak, (0.4 + state.dive * 1.6 + state.open * 0.2) * (1 - state.lock))
    gl.uniform1f(fieldU.uLock, state.lock)
    gl.uniform1f(fieldU.uVis, state.vis)
    gl.uniform2f(fieldU.uLockNdc, state.lockNdc[0], state.lockNdc[1])
    gl.uniform1f(fieldU.uLockPx, state.lockPx)
    gl.uniform3fv(fieldU.uCore, hex('#ffedd5'))
    gl.uniform3fv(fieldU.uMid, hex('#f97316'))
    gl.uniform3fv(fieldU.uEdge, hex('#c2410c'))
    attrib(gl, fieldA.seed, fieldSeed, 4)
    attrib(gl, fieldA.mark, fieldMark, 2)
    attrib(gl, fieldA.cloud, fieldCloud, 2)
    gl.uniform1f(fieldU.uPass, 1)
    gl.drawArrays(gl.POINTS, 0, fieldCount)
    gl.uniform1f(fieldU.uPass, 0)
    gl.drawArrays(gl.POINTS, 0, fieldCount)

    /* Structure (lines + racks) only once the camera has moved in on it.
       The hero stays a particle volume, the way the reference clip reads. */
    const showStructure = state.highlight > 0.35 || state.expand > 0.08 || state.dive > 0.28

    /* ================= network graph + travelling pulses ================= */
    if (showStructure) {
    gl.useProgram(linkProg)
    gl.blendFunc(gl.ONE, gl.ONE) // additive; the shader outputs premultiplied colour

    packetTimer -= dt
    if (packetTimer <= 0) {
      packetTimer = 0.55 + Math.random() * 1.5
      packetSlot = Math.floor(Math.random() * 100000)
    }

    gl.uniformMatrix4fv(linkU.uView, false, view)
    gl.uniformMatrix4fv(linkU.uProj, false, proj)
    gl.uniformMatrix4fv(linkU.uModel, false, model)
    gl.uniform1f(linkU.uCount, cluster.all.length)
    gl.uniform1f(linkU.uSeed, (t * 0.055) % 1000)
    gl.uniform1f(linkU.uSlot0, packetSlot)
    // two background pulses on independent short cycles Ã¢â‚¬â€ enough to keep the
    // graph alive without ever looking like a light show
    gl.uniform1f(linkU.uSlot1, Math.floor(((t * 0.31) % 1) * 100000))
    gl.uniform1f(linkU.uSlot2, Math.floor(((t * 0.17) % 1) * 100000))
    gl.uniform1f(linkU.uBaseOpacity, state.link * 0.07)
    gl.uniform1f(linkU.uPulseGain, state.pulse * 0.28)
    gl.uniform3fv(linkU.uColor, hex('#f97316'))
    gl.uniform3fv(linkU.uPulseColor, hex('#fdba74'))

    attrib(gl, linkA.pos, lvbo.pos, 3)
    attrib(gl, linkA.ida, lvbo.ida, 1)
    attrib(gl, linkA.idb, lvbo.idb, 1)
    attrib(gl, linkA.t, lvbo.t, 1)
    attrib(gl, linkA.tier, lvbo.tier, 1)
    attrib(gl, linkA.len, lvbo.len, 1)
    gl.drawArrays(gl.LINES, 0, lines.count)
    }

    /* ================= rack blocks, small and emissive inside the volume ================= */
    if (showStructure) {
    gl.useProgram(rackProg)
    gl.uniformMatrix4fv(rackU.uView, false, view)
    gl.uniformMatrix4fv(rackU.uProj, false, proj)
    gl.uniformMatrix4fv(rackU.uModel, false, model)
    gl.uniform1f(rackU.uTime, t)
    gl.uniform1f(rackU.uExpand, state.expand)
    gl.uniform1f(rackU.uHighlight, state.highlight)
    gl.uniform1f(rackU.uGrain, 0.22)
    gl.uniform3fv(rackU.uBase, hex('#f97316'))
    gl.uniform3fv(rackU.uRim, hex('#ffedd5'))
    gl.uniform3fv(rackU.uAccent, hex('#fdba74'))
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.depthMask(false)
    bindRackAttributes(vbo.inst)
    drawInstanced(gl, gl.TRIANGLES, boxIdx.length, gl.UNSIGNED_SHORT, 0, rack.count)

    if (state.expand > 0.03) {
      gl.uniform1f(rackU.uHighlight, 0)
      gl.uniform1f(rackU.uGrain, 0.72)
      gl.uniform3fv(rackU.uBase, hex('#ea580c'))
      gl.uniform3fv(rackU.uRim, hex('#fdba74'))
      gl.uniform3fv(rackU.uAccent, hex('#f97316'))
      bindRackAttributes(shellBuf)
      drawInstanced(gl, gl.TRIANGLES, boxIdx.length, gl.UNSIGNED_SHORT, 0, cluster.core.length)
    }
    }

    /* ================= service rings ================= */
    gl.useProgram(solidProg)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.depthMask(false)

    const drawRing = (scale, tilt, rotZ, color, opacity) => {
      const rx = Math.PI / 2 + tilt
      const cz = Math.cos(rotZ)
      const sz = Math.sin(rotZ)
      const cx = Math.cos(rx)
      const sx = Math.sin(rx)
      const rm = new Float32Array([
        cz * scale, sz * cx * scale, sz * sx * scale, 0,
        -sz * scale, cz * cx * scale, cz * sx * scale, 0,
        0, -sx * scale, cx * scale, 0,
        groupX, groupY, 0, 1
      ])
      gl.uniformMatrix4fv(solidU.uView, false, view)
      gl.uniformMatrix4fv(solidU.uProj, false, proj)
      gl.uniformMatrix4fv(solidU.uModel, false, rm)
      gl.uniform3fv(solidU.uColor, color)
      gl.uniform1f(solidU.uOpacity, opacity)
      attrib(gl, solidA.pos, ringBuf.buf, 3)
      gl.drawArrays(gl.LINES, 0, ringBuf.count)
    }

    drawRing(8.4, Math.sin(t * 0.07) * 0.12, t * 0.04, hex('#f97316'), 0.045 * calm)
    drawRing(10.2, -0.35 + Math.cos(t * 0.06) * 0.1, -t * 0.028, hex('#fdba74'), 0.028 * calm)

    gl.disable(gl.BLEND)
    gl.depthMask(true)

    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)

  return {
    quality,
    state,
    /* exposed for verification */
    debug() {
      return {
        attribLocs: {
          rack: rackA,
          link: linkA,
          cloud: cloudA,
          solid: solidA
        },
        uniformLocs: {
          rack: Object.keys(rackU).filter((k) => rackU[k] === null),
          link: Object.keys(linkU).filter((k) => linkU[k] === null),
          cloud: Object.keys(cloudU).filter((k) => cloudU[k] === null),
          solid: Object.keys(solidU).filter((k) => solidU[k] === null)
        },
        boxIdxLen: boxIdx.length,
        boxVertCount: boxVerts.length / 3,
        eye: eye.slice(),
        look: state.look.slice(),
        fov: state.fov,
        rackCount: rack.count,
        coreCount: cluster.core.length,
        lineCount: lines.count,
        cloudCounts: Object.keys(cloudBuf).map((k) => k + ':' + cloudBuf[k].count),
        aspect: state.aspect,
        story: scroll.story,
        ready: ready,
        spin: state.spin,
        link: state.link,
        bank: state.bank,
        dive: state.dive,
        open: state.open,
        dpr: state.dpr,
        canvas: [canvas.width, canvas.height]
      }
    },
    setReady(v) {
      ready = v
      if (!v) return
      // brief cinematic fly-in once the intro finishes
      const start = performance.now()
      const span = 2600
      const tick = () => {
        const p = clamp((performance.now() - start) / span, 0, 1)
        state.camY = lerp(-2.4, 0, 1 - Math.pow(1 - p, 3))
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
  }
}

/* ============================================================
   Page behaviour
   ============================================================ */

let scene = null

function initPage() {
  /* ---------- copyright year ---------- */
  const year = document.getElementById('year')
  if (year) year.textContent = String(new Date().getFullYear())

  /* ---------- intro overlay ---------- */
  const loader = document.getElementById('loader')
  document.body.classList.add('is-loading')
  window.setTimeout(() => {
    document.body.classList.remove('is-loading')
    if (loader) loader.classList.add('is-done')
    if (scene) scene.setReady(true)
  }, 900)

  /* ---------- pinned nav + scroll progress ---------- */
  const nav = document.getElementById('nav')
  const rail = document.getElementById('navRail')
  const railButtons = Array.prototype.slice.call(document.querySelectorAll('#progress button'))

  /* ---------- mobile menu ---------- */
  const burger = document.getElementById('navBurger')
  const menu = document.getElementById('navMenu')
  const setMenu = (open) => {
    if (!nav || !burger) return
    nav.classList.toggle('menu-open', open)
    burger.setAttribute('aria-expanded', open ? 'true' : 'false')
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
  }
  if (burger && menu) {
    burger.addEventListener('click', () => setMenu(!nav.classList.contains('menu-open')))
    menu.addEventListener('click', (e) => {
      if (e.target.closest('a')) setMenu(false)
    })
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setMenu(false)
    })
    window.addEventListener('resize', () => {
      if (window.innerWidth > 980) setMenu(false)
    })
  }

  let queued = false
  /* Scroll-linked effects register here rather than each attaching its own
     scroll listener, so every frame is computed once, in one rAF, off one
     read of scrollY. */
  const scrollFx = []
  const onScroll = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      const doc = document.documentElement
      const sy = window.scrollY
      const vh = window.innerHeight
      const max = Math.max(1, doc.scrollHeight - vh)
      const p = clamp(sy / max, 0, 1)
      if (nav) nav.classList.toggle('is-pinned', sy > 30)
      if (rail) rail.style.transform = 'scaleX(' + p + ')'

      const y = sy + vh * 0.5
      let active = 0
      railButtons.forEach((b, i) => {
        const el = document.getElementById(b.dataset.target)
        if (!el) return
        let top = 0
        let node = el
        while (node) {
          top += node.offsetTop
          node = node.offsetParent
        }
        if (y >= top) active = i
      })
      railButtons.forEach((b, i) => b.classList.toggle('is-active', i === active))

      for (let i = 0; i < scrollFx.length; i++) scrollFx[i](sy, vh, p)
    })
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
  onScroll()

  railButtons.forEach((b) => {
    b.addEventListener('click', () => {
      const el = document.getElementById(b.dataset.target)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  })

  /* ---------- scroll reveals ----------
     A `.reveal-scroll` block eases up as it enters the frame; its children
     (cards, rows, quotes) then follow as a staggered wave rather than all
     snapping in together. The observer only queues work — the classes are
     applied inside one rAF so a grid of cards costs a single style pass,
     and `will-change` is dropped on transitionend so idle sections stay
     on the cheap texture path while scrolling. */
  const motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal-scroll'))

  /* Stagger groups. In this markup a grid holds sibling `.reveal-scroll`
     cards (each card is its own reveal block), so the wave is produced by
     delaying each card inside its grid by its index. A panel that instead
     owns inner rows (its spec list, its contact rows) staggers those rows. */
  const GRID_SEL =
    '.cap-grid, .svc-grid, .price-grid, .family-grid, .proof, .quote-grid, .contact-rows'
  const ROW_SEL = '.spec-list li, .contact-rows a, .contact-rows .row'

  revealEls.forEach((parent) => {
    const rows = parent.querySelectorAll(ROW_SEL)
    for (let i = 0; i < rows.length; i++) {
      rows[i].setAttribute('data-reveal-child', '')
      rows[i].style.setProperty('--reveal-delay', 'calc(' + i + ' * var(--reveal-stagger))')
    }
  })

  /* Give each card inside a multi-card grid its own index delay. */
  Array.prototype.forEach.call(document.querySelectorAll(GRID_SEL), (grid) => {
    const cards = Array.prototype.filter.call(grid.children, (el) =>
      el.classList.contains('reveal-scroll')
    )
    if (cards.length < 2) return
    cards.forEach((el, i) => {
      el.style.setProperty('--reveal-delay', 'calc(' + i + ' * var(--reveal-stagger))')
    })
  })

  function release(el) {
    if (el.classList.contains('is-in')) return
    el.classList.add('is-in')
    const kids = el.hasAttribute('data-reveal-child') ? [] : el.querySelectorAll('[data-reveal-child]')
    for (let i = 0; i < kids.length; i++) kids[i].classList.add('is-in')
  }

  function dropWillChange(el) {
    el.style.willChange = 'auto'
  }
  document.addEventListener(
    'transitionend',
    (e) => {
      const el = e.target
      if (el.nodeType !== 1 || !el.classList.contains('is-in')) return
      if (e.propertyName === 'transform') dropWillChange(el)
    },
    { passive: true }
  )

  if (!motionOK) {
    revealEls.forEach(release)
    document.querySelectorAll('[data-reveal-child]').forEach((el) => el.classList.add('is-in'))
  } else if ('IntersectionObserver' in window) {
    let flushQueued = false
    const pending = []
    const flush = () => {
      flushQueued = false
      pending.splice(0).forEach(release)
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          pending.push(entry.target)
          io.unobserve(entry.target)
        })
        if (pending.length && !flushQueued) {
          flushQueued = true
          requestAnimationFrame(flush)
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -10% 0px' }
    )
    revealEls.forEach((el) => io.observe(el))

    /* Subtle depth: the copy drifts a few pixels against the scroll while a
       block is still crossing the frame, then settles — the section change
       reads as a camera move rather than a hard cut. Cheap: one transform,
       no layout, and it stops once the element is well inside. */
    const parallaxEls = Array.prototype.filter.call(revealEls, (el) => el.offsetHeight > 0)
    const PARALLAX = 26
    scrollFx.push((sy, vh) => {
      for (let i = 0; i < parallaxEls.length; i++) {
        const el = parallaxEls[i]
        if (!el.classList.contains('is-in')) continue
        const r = el.getBoundingClientRect()
        if (r.bottom < -vh * 0.5 || r.top > vh * 1.5) continue
        const c = (r.top + r.height * 0.5 - vh * 0.5) / vh
        const y = clamp(c, -1, 1) * PARALLAX
        el.style.setProperty('--drift', y.toFixed(2) + 'px')
      }
    })
  } else {
    revealEls.forEach(release)
  }

  /* ---------- contact form ---------- */
  const form = document.getElementById('contactForm')
  const status = document.getElementById('formStatus')

  if (form && status) {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const fields = ['name', 'email', 'message'].map((n) => form.elements[n])
      let ok = true
      fields.forEach((f) => {
        const bad =
          !f.value.trim() || (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.value))
        f.parentElement.classList.toggle('has-error', bad)
        if (bad) ok = false
      })
      if (!ok) {
        status.textContent = 'Check the highlighted fields and try again.'
        status.className = 'form-status is-bad'
        return
      }
      const button = form.querySelector('button[type=submit]')
      button.disabled = true
      status.textContent = 'Sending...'
      status.className = 'form-status'
      window.setTimeout(() => {
        button.disabled = false
        status.textContent = 'Thanks - that reached us. We reply the same working day.'
        status.className = 'form-status is-ok'
        form.reset()
      }, 700)
    })
  }
}

/* ============================================================
   Boot
   ============================================================ */

function boot() {
  const canvas = document.getElementById('scene')
  if (canvas) {
    try {
      scene = createCluster(canvas)
    } catch (err) {
      scene = null
      if (window.console) console.warn('3D stage unavailable:', err)
    }
    if (!scene) document.body.classList.add('no-webgl')
  }
  window.__ccScene = scene
  initPage()
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
}

