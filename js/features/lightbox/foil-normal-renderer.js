/**
 * Per-pixel holographic foil relief.
 * Grayscale source maps become height fields whose slopes are blended into a
 * tangent-space normal. A moving virtual key light produces spectral specular
 * highlights. CSS masks remain responsible for foil coverage and artwork alpha.
 */
const VERTEX_SOURCE = `
attribute vec2 a_position;
attribute vec2 a_uv;
varying vec2 v_uv;
void main(){gl_Position=vec4(a_position,0.0,1.0);v_uv=a_uv;}
`;
const FRAGMENT_SOURCE = `
precision mediump float;
uniform sampler2D u_map0; uniform sampler2D u_map1;
uniform sampler2D u_map2; uniform sampler2D u_map3;
uniform vec2 u_texel0; uniform vec2 u_texel1;
uniform vec2 u_texel2; uniform vec2 u_texel3;
uniform float u_mapCount; uniform float u_intensity; uniform float u_phase;
uniform vec2 u_light;
varying vec2 v_uv;
float luminance(vec4 c){return dot(c.rgb,vec3(0.2126,0.7152,0.0722))*c.a;}
float heightAt0(vec2 p){return luminance(texture2D(u_map0,clamp(p,vec2(0.0),vec2(1.0))));}
float heightAt1(vec2 p){return luminance(texture2D(u_map1,clamp(p,vec2(0.0),vec2(1.0))));}
float heightAt2(vec2 p){return luminance(texture2D(u_map2,clamp(p,vec2(0.0),vec2(1.0))));}
float heightAt3(vec2 p){return luminance(texture2D(u_map3,clamp(p,vec2(0.0),vec2(1.0))));}
vec3 foilSpectrum(float h){
  vec3 band=abs(fract(h+vec3(0.0,0.6666667,0.3333333))*6.0-3.0);
  vec3 c=clamp(band-1.0,0.0,1.0);
  return c*c*(3.0-2.0*c);
}
vec3 blendFoilNormals(vec2 s0,vec2 s1,vec2 s2,vec2 s3,float w1,float w2,float w3){
  // Whiteout-style tangent-space blending: combine the independent map slopes,
  // then normalize once so overlapping Cosmos/custom patterns share one normal.
  return normalize(vec3((s0+s1*w1+s2*w2+s3*w3)*2.1,1.0));
}
void main(){
  vec4 c0=texture2D(u_map0,v_uv),c1=texture2D(u_map1,v_uv);
  vec4 c2=texture2D(u_map2,v_uv),c3=texture2D(u_map3,v_uv);
  float w1=step(1.5,u_mapCount),w2=step(2.5,u_mapCount),w3=step(3.5,u_mapCount);
  float h0L=heightAt0(v_uv-vec2(u_texel0.x,0.0)),h0R=heightAt0(v_uv+vec2(u_texel0.x,0.0));
  float h0U=heightAt0(v_uv+vec2(0.0,u_texel0.y)),h0D=heightAt0(v_uv-vec2(0.0,u_texel0.y));
  float h1L=heightAt1(v_uv-vec2(u_texel1.x,0.0)),h1R=heightAt1(v_uv+vec2(u_texel1.x,0.0));
  float h1U=heightAt1(v_uv+vec2(0.0,u_texel1.y)),h1D=heightAt1(v_uv-vec2(0.0,u_texel1.y));
  float h2L=heightAt2(v_uv-vec2(u_texel2.x,0.0)),h2R=heightAt2(v_uv+vec2(u_texel2.x,0.0));
  float h2U=heightAt2(v_uv+vec2(0.0,u_texel2.y)),h2D=heightAt2(v_uv-vec2(0.0,u_texel2.y));
  float h3L=heightAt3(v_uv-vec2(u_texel3.x,0.0)),h3R=heightAt3(v_uv+vec2(u_texel3.x,0.0));
  float h3U=heightAt3(v_uv+vec2(0.0,u_texel3.y)),h3D=heightAt3(v_uv-vec2(0.0,u_texel3.y));
  vec2 s0=vec2(h0L-h0R,h0D-h0U)*3.2;
  vec2 s1=vec2(h1L-h1R,h1D-h1U)*3.2;
  vec2 s2=vec2(h2L-h2R,h2D-h2U)*3.2;
  vec2 s3=vec2(h3L-h3R,h3D-h3U)*3.2;
  vec3 normal=blendFoilNormals(s0,s1,s2,s3,w1,w2,w3);
  float cv0=luminance(c0),cv1=luminance(c1)*w1,cv2=luminance(c2)*w2,cv3=luminance(c3)*w3;
  float coverage=max(cv0,max(cv1,max(cv2,cv3)));
  if(coverage<0.008||u_intensity<=0.001){gl_FragColor=vec4(0.0);return;}
  float e0=max(abs(h0L-h0R),abs(h0U-h0D));
  float e1=max(abs(h1L-h1R),abs(h1U-h1D))*w1;
  float e2=max(abs(h2L-h2R),abs(h2U-h2D))*w2;
  float e3=max(abs(h3L-h3R),abs(h3U-h3D))*w3;
  float edge=clamp(max(e0,max(e1,max(e2,e3)))*3.1,0.0,1.0);
  vec3 L=normalize(vec3((u_light.x-v_uv.x)*1.7,(u_light.y-v_uv.y)*1.7,0.82));
  vec3 V=vec3(0.0,0.0,1.0),H=normalize(L+V);
  float diffuse=max(dot(normal,L),0.0);
  float specular=pow(max(dot(normal,H),0.0),25.0);
  float grazing=1.0-clamp(normal.z,0.0,1.0);
  float hue=fract(u_phase+v_uv.x*0.48+v_uv.y*0.15+atan(normal.y,normal.x)*0.035+dot(normal,L)*0.11);
  vec3 spectral=foilSpectrum(hue);
  vec3 color=spectral*(0.16+specular*0.78+edge*0.28)+vec3(1.0)*specular*0.56+vec3(0.24,0.82,1.0)*edge*0.16;
  float alpha=coverage*u_intensity*clamp(0.025+specular*0.48+edge*0.34+grazing*0.075,0.0,0.86);
  gl_FragColor=vec4(color,alpha);
}
`;
const NOOP=Object.freeze({setLight(){},destroy(){}});
export function createFoilNormalRenderer(canvas,patternUrls,{intensity=0.8,phase=0.18}={}){
  if(!canvas?.getContext)return NOOP;
  const documentRef=canvas.ownerDocument||globalThis.document,view=documentRef?.defaultView||globalThis.window;
  let gl=null;
  try{gl=canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'})||canvas.getContext('experimental-webgl');}catch(_){}
  if(!gl){canvas.dataset.normalMapStatus='unsupported';return NOOP;}
  let disposed=false,ready=false,textures=[],loadedImages=[],resizeObserver=null,width=0,height=0,lightX=0.34,lightY=0.74;
  const level=Math.max(0,Math.min(1,Number(intensity)||0));
  const mapUrls=Array.from(new Set((patternUrls||[]).map(v=>String(v||'').trim()).filter(Boolean))).slice(0,4);
  canvas.dataset.normalMapPatternCount=String(mapUrls.length);
  canvas.dataset.normalMapStatus='loading';
  function compileShader(type,source){
    const shader=gl.createShader(type);if(!shader)throw new Error('Unable to allocate foil shader.');
    gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader)||'Foil shader compilation failed.';gl.deleteShader(shader);throw new Error(message);}
    return shader;
  }
  let program=null,vertexShader=null,fragmentShader=null,vertexBuffer=null,uniform=null;
  const emptyPixel=new Uint8Array([128,128,128,0]);
  try{
    vertexShader=compileShader(gl.VERTEX_SHADER,VERTEX_SOURCE);fragmentShader=compileShader(gl.FRAGMENT_SHADER,FRAGMENT_SOURCE);
    program=gl.createProgram();if(!program)throw new Error('Unable to allocate foil program.');
    gl.attachShader(program,vertexShader);gl.attachShader(program,fragmentShader);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Foil shader link failed.');
    vertexBuffer=gl.createBuffer();if(!vertexBuffer)throw new Error('Unable to allocate foil geometry.');
    gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,1,1,1,1]),gl.STATIC_DRAW);
    uniform={position:gl.getAttribLocation(program,'a_position'),uv:gl.getAttribLocation(program,'a_uv'),mapCount:gl.getUniformLocation(program,'u_mapCount'),intensity:gl.getUniformLocation(program,'u_intensity'),phase:gl.getUniformLocation(program,'u_phase'),light:gl.getUniformLocation(program,'u_light'),maps:[0,1,2,3].map(i=>gl.getUniformLocation(program,'u_map'+i)),texels:[0,1,2,3].map(i=>gl.getUniformLocation(program,'u_texel'+i))};
    gl.useProgram(program);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);
    for(let i=0;i<4;i++){
      const texture=gl.createTexture();if(!texture)throw new Error('Unable to allocate foil pattern texture.');
      textures.push(texture);gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,emptyPixel);
      gl.uniform1i(uniform.maps[i],i);gl.uniform2f(uniform.texels[i],1,1);
    }
  }catch(_){
    canvas.dataset.normalMapStatus='unsupported';
    try{if(program)gl.deleteProgram(program);}catch(_){}
    try{if(vertexShader)gl.deleteShader(vertexShader);}catch(_){}
    try{if(fragmentShader)gl.deleteShader(fragmentShader);}catch(_){}
    try{if(vertexBuffer)gl.deleteBuffer(vertexBuffer);}catch(_){}
    textures.forEach(t=>{try{gl.deleteTexture(t);}catch(_){}});return NOOP;
  }
  function draw(){
    if(disposed||!ready||!uniform)return;
    const rect=canvas.getBoundingClientRect();if(!(rect.width>0&&rect.height>0))return;
    const dpr=Math.min(Math.max(Number(view?.devicePixelRatio)||1,0.65),0.85);
    const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
    if(w!==width||h!==height){width=w;height=h;canvas.width=w;canvas.height=h;}
    gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.enableVertexAttribArray(uniform.position);gl.vertexAttribPointer(uniform.position,2,gl.FLOAT,false,16,0);
    gl.enableVertexAttribArray(uniform.uv);gl.vertexAttribPointer(uniform.uv,2,gl.FLOAT,false,16,8);
    gl.uniform1f(uniform.mapCount,loadedImages.length);gl.uniform1f(uniform.intensity,level);gl.uniform1f(uniform.phase,Number(phase)||0);gl.uniform2f(uniform.light,lightX,lightY);
    for(let i=0;i<4;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);const image=loadedImages[i];if(image)gl.uniform2f(uniform.texels[i],1/Math.max(1,image.naturalWidth||image.width),1/Math.max(1,image.naturalHeight||image.height));}
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
  const handleResize=()=>draw(),RO=view?.ResizeObserver;
  if(typeof RO==='function'){resizeObserver=new RO(handleResize);resizeObserver.observe(canvas);}else view?.addEventListener?.('resize',handleResize,{passive:true});
  async function loadPatterns(){
    const ImageCtor=view?.Image||globalThis.Image;
    if(typeof ImageCtor!=='function'||!mapUrls.length){canvas.dataset.normalMapStatus='unavailable';return;}
    const requests=mapUrls.map(url=>new Promise(resolve=>{const image=new ImageCtor();image.decoding='async';image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=url;}));
    const results=await Promise.all(requests);if(disposed)return;loadedImages=results.filter(Boolean);
    canvas.dataset.normalMapLoadedCount=String(loadedImages.length);
    if(!loadedImages.length){canvas.dataset.normalMapStatus='unavailable';return;}
    for(let i=0;i<loadedImages.length;i++){try{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,loadedImages[i]);}catch(_){loadedImages=[];canvas.dataset.normalMapStatus='unavailable';return;}}
    ready=true;canvas.dataset.normalMapStatus='ready';draw();
  }
  void loadPatterns().catch(()=>{if(!disposed)canvas.dataset.normalMapStatus='unavailable';});
  return {
    setLight(x,y){lightX=Math.max(0,Math.min(1,Number(x)||0));lightY=Math.max(0,Math.min(1,Number(y)||0));draw();},
    destroy(){
      if(disposed)return;disposed=true;ready=false;resizeObserver?.disconnect();view?.removeEventListener?.('resize',handleResize);
      loadedImages.forEach(image=>{image.onload=null;image.onerror=null;image.src='';});loadedImages=[];
      textures.forEach(t=>{try{gl.deleteTexture(t);}catch(_){}});textures=[];
      try{if(vertexBuffer)gl.deleteBuffer(vertexBuffer);}catch(_){}
      try{if(program)gl.deleteProgram(program);}catch(_){}
      try{if(vertexShader)gl.deleteShader(vertexShader);}catch(_){}
      try{if(fragmentShader)gl.deleteShader(fragmentShader);}catch(_){}
      try{gl.getExtension('WEBGL_lose_context')?.loseContext();}catch(_){}
      canvas.width=0;canvas.height=0;
    }
  };
}
