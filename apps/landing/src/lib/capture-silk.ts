import { Mesh, Program, Renderer, Triangle } from 'ogl'

const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return [1, 1, 1]
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ]
}

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const fragment = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uColor;
uniform float uSpeed;
uniform float uScale;
uniform float uRotation;
uniform float uNoiseIntensity;
out vec4 fragColor;

const float e = 2.71828182845904523536;

float noise(vec2 texCoord) {
  float G = e;
  vec2 r = G * sin(G * texCoord);
  return fract(r.x * r.y * (1.0 + texCoord.x));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2 rot = mat2(c, -s, s, c);
  return rot * uv;
}

void main() {
  float rnd = noise(gl_FragCoord.xy);
  vec2 uv = gl_FragCoord.xy / uResolution;
  uv = rotateUvs(uv * uScale, uRotation);
  vec2 tex = uv * uScale;
  float tOffset = uSpeed * uTime;

  tex.y += 0.03 * sin(8.0 * tex.x - tOffset);

  float pattern = 0.6 +
    0.4 * sin(5.0 * (tex.x + tex.y +
      cos(3.0 * tex.x + 5.0 * tex.y) +
      0.02 * tOffset) +
      sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));

  vec4 col = vec4(uColor, 1.0) * vec4(vec3(pattern), 1.0) - rnd / 15.0 * uNoiseIntensity;
  col.a = 1.0;
  fragColor = col;
}
`

let cached: Promise<string> | null = null

export function captureSilk(): Promise<string> {
  if (typeof window === 'undefined') return Promise.resolve('')
  if (cached) return cached

  cached = new Promise<string>((resolve) => {
    const size = 256
    const renderer = new Renderer({
      webgl: 2,
      alpha: false,
      antialias: false,
      width: size,
      height: size,
      dpr: 1,
    })

    const gl = renderer.gl
    const geometry = new Triangle(gl)
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uResolution: { value: new Float32Array([size, size]) },
        uTime: { value: 1.0 },
        uColor: { value: new Float32Array(hexToRgb('#7B7481')) },
        uSpeed: { value: 5.0 },
        uScale: { value: 1.0 },
        uRotation: { value: 0.0 },
        uNoiseIntensity: { value: 1.5 },
      },
    })

    const mesh = new Mesh(gl, { geometry, program })
    renderer.render({ scene: mesh })

    const dataUrl = (gl.canvas as HTMLCanvasElement).toDataURL('image/png')

    const ext = gl.getExtension('WEBGL_lose_context')
    ext?.loseContext()

    resolve(dataUrl)
  })

  return cached
}
