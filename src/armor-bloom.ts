import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

const vertex = `varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

/** One geometry pass + a small blur. Preserve alpha for the desktop window. */
export class ArmorBloom {
  private beauty = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 2,
  });
  private bright = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  private blur = this.bright.clone();
  private glow = this.bright.clone();
  private extract = new THREE.ShaderMaterial({
    uniforms: { source: { value: this.beauty.texture } },
    vertexShader: vertex,
    fragmentShader: `varying vec2 vUv; uniform sampler2D source;
    void main(){
      vec4 c=texture2D(source,vUv);
      // Extract luminous accents, keeping bright metal reflections sharp.
      float energy=max(c.r,max(c.g,c.b));
      float chroma=max(0.,energy-min(c.r,min(c.g,c.b)));
      float gate=smoothstep(1.1,2.4,energy)*smoothstep(.15,.9,chroma);
      gl_FragColor=vec4(c.rgb*gate,1.);
    }`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private gaussian = new THREE.ShaderMaterial({
    uniforms: {
      source: { value: this.bright.texture },
      stepSize: { value: new THREE.Vector2() },
    },
    vertexShader: vertex,
    fragmentShader: `varying vec2 vUv; uniform sampler2D source; uniform vec2 stepSize;
    void main(){
      vec3 c=texture2D(source,vUv).rgb*.227027;
      c+=(texture2D(source,vUv+stepSize*1.384615).rgb+texture2D(source,vUv-stepSize*1.384615).rgb)*.316216;
      c+=(texture2D(source,vUv+stepSize*3.230769).rgb+texture2D(source,vUv-stepSize*3.230769).rgb)*.070270;
      gl_FragColor=vec4(c,1.);
    }`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private composite = new THREE.ShaderMaterial({
    uniforms: {
      source: { value: this.beauty.texture },
      bloom: { value: this.glow.texture },
      strength: { value: 0.5 },
    },
    vertexShader: vertex,
    fragmentShader: `varying vec2 vUv; uniform sampler2D source; uniform sampler2D bloom; uniform float strength;
    void main(){
      vec4 base=texture2D(source,vUv);
      vec3 halo=texture2D(bloom,vUv).rgb*strength;
      float a=base.a+(1.-base.a)*(1.-exp(-max(halo.r,max(halo.g,halo.b))*.65));
      gl_FragColor=vec4((base.rgb+halo)/max(a,.0001),a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      // WebGL canvas composition expects premultiplied alpha; empty pixels stay 0.
      gl_FragColor.rgb*=a;
    }`,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  private quad = new FullScreenQuad(this.extract);
  private enabled: boolean;
  private width = 0;
  private height = 0;
  constructor(private renderer: THREE.WebGLRenderer) {
    this.enabled = renderer.extensions.has("EXT_color_buffer_float");
  }
  resize(width: number, height: number, pixelRatio: number) {
    const w = Math.max(1, Math.round(width * pixelRatio));
    const h = Math.max(1, Math.round(height * pixelRatio));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.beauty.setSize(w, h);
    const ratio = Math.min(0.25, 640 / Math.max(w, h));
    for (const target of [this.bright, this.blur, this.glow])
      target.setSize(
        Math.max(1, Math.round(w * ratio)),
        Math.max(1, Math.round(h * ratio)),
      );
  }
  private pass(
    material: THREE.ShaderMaterial,
    target: THREE.WebGLRenderTarget | null,
  ) {
    this.renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(this.renderer);
  }
  render(scene: THREE.Scene, camera: THREE.Camera, strength: number) {
    if (!this.enabled || strength <= 0) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    this.renderer.setRenderTarget(this.beauty);
    this.renderer.render(scene, camera);
    this.pass(this.extract, this.bright);
    this.gaussian.uniforms.source.value = this.bright.texture;
    this.gaussian.uniforms.stepSize.value.set(1.15 / this.bright.width, 0);
    this.pass(this.gaussian, this.blur);
    this.gaussian.uniforms.source.value = this.blur.texture;
    this.gaussian.uniforms.stepSize.value.set(0, 1.15 / this.bright.height);
    this.pass(this.gaussian, this.glow);
    this.composite.uniforms.strength.value = strength;
    this.pass(this.composite, null);
  }
  dispose() {
    for (const target of [this.beauty, this.bright, this.blur, this.glow])
      target.dispose();
    this.extract.dispose();
    this.gaussian.dispose();
    this.composite.dispose();
    this.quad.dispose();
  }
}
