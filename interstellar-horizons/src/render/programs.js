import { linkProgram } from './gl.js';

import vertSrc from '../shaders/vert.glsl';

import sRayleigh from '../shaders/strip_rayleigh.glsl';
import sPreetham from '../shaders/strip_preetham.glsl';
import sNishita  from '../shaders/strip_nishita.glsl';
import sHosek    from '../shaders/strip_hosek.glsl';
import sOzone    from '../shaders/strip_ozone.glsl';
import sCie      from '../shaders/strip_cie.glsl';

import dRayleigh from '../shaders/dome_rayleigh.glsl';
import dPreetham from '../shaders/dome_preetham.glsl';
import dNishita  from '../shaders/dome_nishita.glsl';
import dHosek    from '../shaders/dome_hosek.glsl';
import dOzone    from '../shaders/dome_ozone.glsl';
import dCie      from '../shaders/dome_cie.glsl';

const STRIP_SRC = { rayleigh: sRayleigh, preetham: sPreetham, nishita: sNishita,
                    hosek: sHosek, ozone: sOzone, cie: sCie };
const DOME_SRC  = { rayleigh: dRayleigh, preetham: dPreetham, nishita: dNishita,
                    hosek: dHosek, ozone: dOzone, cie: dCie };

export function buildPrograms(gl) {
  const out = { strip: {}, dome: {} };
  for (const [name, src] of Object.entries(STRIP_SRC)) {
    try { out.strip[name] = linkProgram(gl, vertSrc, src); }
    catch (e) { console.warn(`strip_${name} skipped:`, e.message); }
  }
  for (const [name, src] of Object.entries(DOME_SRC)) {
    try { out.dome[name] = linkProgram(gl, vertSrc, src); }
    catch (e) { console.warn(`dome_${name} skipped:`, e.message); }
  }
  return out;
}
