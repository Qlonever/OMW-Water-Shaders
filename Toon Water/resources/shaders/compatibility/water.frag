#version 120

#if @useGPUShader4
    #extension GL_EXT_gpu_shader4: require
#endif

#include "lib/core/fragment.h.glsl"

// Inspired by Blender GLSL Water by martinsh ( https://devlog-martinsh.blogspot.de/2012/07/waterundewater-shader-wip.html )

// tweakables -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --

const vec4 VISIBILITY = vec4(0.65, 0.80, 0.97, 0.5);    // RGB light extinction + fog exponents

const float WAVE_STRENGTH = 1.0;                        // wave intensity
const float RAIN_WAVE_STRENGTH = 1.8;                   // intensity of extra waves added during rain

const float WAVE_SCALE = 4.0;                           // overall wave scale
const float WAVE_SPEED = 0.03;                          // overall wave speed

const float REFL_BUMP = 0.3;                            // reflection distortion amount
const float REFR_BUMP = 0.03;                           // refraction distortion amount
const float REFL_RAY_LENGTH = 1000.0;                   // length of reflection ray used for distortion

const float RAIN_RIPPLE_STRENGTH = 2.0;                 // strength of normals from rain ripples
const float ACTOR_RIPPLE_STRENGTH = 8.0;                // strength of normals from actor ripples

const float SUN_SPEC_FADING_THRESHOLD = 0.15;           // visibility at which sun specularity starts to fade
const float SPEC_BRIGHTNESS = 0.8;                      // boosts the brightness of the specular highlights

const float BUMP_SUPPRESS_DEPTH = 300.0;                // at what water depth bumpmap will be suppressed for reflections and refractions (prevents artifacts at shores)

const float SHORE_DEPTH = 40.0;                           // depth to use for shore outlines

const vec3 WATER_COLOR = vec3(0.2, 0.3, 0.4);           // surface tint /  refraction fog color
const vec3 SHEEN_COLOR = vec3(0.7, 0.8, 0.9);           // color of faux reflection

#if @wobblyShores
const float WOBBLY_SHORE_FADE_DISTANCE = 6200.0;        // fade out wobbly shores to mask precision errors, the effect is almost impossible to see at a distance
#endif

// -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -

uniform sampler2D rippleMap;
uniform vec3 playerPos;

varying vec3 worldPos;

varying vec2 rippleMapUV;

varying vec4 position;
varying float linearDepth;

uniform sampler2D normalMap;

vec4 heightSamples(vec2 uv, float scale, vec2 speed, float time, mat2 rotation)
{
    return 2.0 * texture2D(normalMap, (uv + speed * WAVE_SPEED * time) * scale * WAVE_SCALE * rotation) - 1.0;
}

uniform float osg_SimulationTime;

uniform float near;
uniform float far;

uniform float rainIntensity;

uniform vec2 screenRes;

#define PER_PIXEL_LIGHTING 0

#include "lib/water/fresnel.glsl"
#include "lib/water/rain_ripples.glsl"
#include "lib/view/depth.glsl"
#include "lib/light/struct.glsl"

#include "shadows_fragment.glsl"
#include "fog.glsl"

uniform DirectionalLight sun;

void main(void)
{
    vec2 UV = worldPos.xy * 0.00008;

    float shadow = unshadowedLightRatio(linearDepth);

    vec3 sunWorldDir = normalize((gl_ModelViewMatrixInverse * sun.position).xyz);
    vec3 cameraPos = (gl_ModelViewMatrixInverse * vec4(0,0,0,1)).xyz;
    vec3 viewDir = normalize(position.xyz - cameraPos.xyz);

    vec2 screenCoords = gl_FragCoord.xy / screenRes;

    #define waterTimer osg_SimulationTime

    //using heightmaps at different scales should technically break height/normal calculation, but it looks nice so whatever
    vec4 height = (heightSamples(UV, 1.05, vec2( 0.01,  0.07), waterTimer, mat2( 1,  0,  0,  1)).xyzw * 1.0
                +  heightSamples(UV, 0.6,  vec2( 0.07, -0.04), waterTimer, mat2( 0,  1, -1,  0)).wxyz * 1.2
                +  heightSamples(UV, 1.3,  vec2(-0.13,  0.03), waterTimer, mat2(-1,  0,  0, -1)).zwxy * 0.7
                +  heightSamples(UV, 1.1,  vec2(-0.05, -0.09), waterTimer, mat2( 0, -1,  1,  0)).yzwx * 0.8)
                * WAVE_STRENGTH;

    float distToCenter = length(rippleMapUV - vec2(0.5));
    float blendClose = smoothstep(10, 60, linearDepth);
    float blendFar = 1.0 - smoothstep(0.3, 0.4, distToCenter);
    vec2 actorRipple = texture2D(rippleMap, rippleMapUV).ba * ACTOR_RIPPLE_STRENGTH * blendFar * blendClose;

    vec4 rainRipple;

    if (rainIntensity > 0.01) {
        height += (heightSamples(UV, 1.2, vec2(-0.14,  0.10), waterTimer, mat2( 1,  0,  0,  1)).xyzw * rainIntensity
                +  heightSamples(UV, 1.2, vec2( 0.07, -0.13), waterTimer, mat2( 0,  1, -1,  0)).wxyz * rainIntensity)
                * RAIN_WAVE_STRENGTH;
        rainRipple = rainCombined(position.xy * 0.001 + actorRipple * 0.01, waterTimer) * RAIN_RIPPLE_STRENGTH * clamp(rainIntensity, 0.0, 1.0) * clamp(1.2 - linearDepth * 0.0003, 0.0, 1.0);
    } else
        rainRipple = vec4(0.0);

    vec2 normalSum = height.zw - height.xy + actorRipple.xy + rainRipple.xy;
    vec3 normal = normalize(vec3(normalSum * clamp(linearDepth * 0.01, 0.5, 1.0), 0.2));
    // This makes point specular work underwater
    if (cameraPos.z < 0.0)
        normal *= -1.0;

    // I think this is basically a fixed-length raymarch
    vec3 reflectVec = reflect(viewDir, normal) * vec3(REFL_RAY_LENGTH, REFL_RAY_LENGTH, -REFL_RAY_LENGTH);
    vec3 reflectCoords = (gl_ModelViewProjectionMatrix * vec4(position.xyz + reflectVec, 1.0)).xyz;

    vec2 screenCoordsOffset = reflectCoords.xy/reflectCoords.zz * 0.5 + vec2(0.5) - screenCoords.xy;

    // fresnel & fake fresnel
    float ior = 1.333;
    float gradient = clamp(fresnel_dielectric(viewDir, vec3(0.0, 0.0, 1.0), ior), 0.0, 1.0);
    float posterize = 1.0 - abs(dot(viewDir, normal));
    posterize *= posterize;
    posterize += rainRipple.w * 1.0;

#if @waterRefraction
    float depthSample = linearizeDepth(sampleRefractionDepthMap(screenCoords), near, far);
    float surfaceDepth = linearDepth;
    float realWaterDepth = depthSample - surfaceDepth;  // undistorted water depth in view direction, independent of frustum
    screenCoordsOffset *= clamp(realWaterDepth / BUMP_SUPPRESS_DEPTH, 0.0, 1.0);
    float depthSampleDistorted = linearizeDepth(sampleRefractionDepthMap(screenCoords - screenCoordsOffset * REFR_BUMP), near, far);
    float waterDepthDistorted = max(depthSampleDistorted - surfaceDepth, 0.0);

    //shoreline highlights
    float viewFactor = mix(abs(viewDir.z), 1.0, 0.2);
    float verticalWaterDepth = realWaterDepth * viewFactor; // an estimate

    float shoreline = max(SHORE_DEPTH - verticalWaterDepth, 0) / SHORE_DEPTH;
    posterize = mix(posterize, 0.8, shoreline * shoreline);

    // do this here so we can ensure raw refraction isn't distorted 
    float shoreOffset = 1.0;

#if @wobblyShores
    // wobbly water: hard-fade into refraction texture at extremely low depth, with a wobble based on heightmap
    shoreOffset = (verticalWaterDepth - height.r * 12.0) * 2.0 + 4.5;
    float fuzzFactor = min(1.0, 1000.0 / surfaceDepth) * viewFactor;
    shoreOffset *= fuzzFactor;
    shoreOffset = clamp(mix(shoreOffset, 1.0, clamp(linearDepth / WOBBLY_SHORE_FADE_DISTANCE, 0.0, 1.0)), 0.0, 1.0);
#endif

#endif
    // reflection
    vec3 reflection = sampleReflectionMap(screenCoords + screenCoordsOffset * REFL_BUMP).rgb;

    vec4 sunSpec = sun.specular;
    // alpha component is sun visibility; we want to start fading lighting effects when visibility is low
    sunSpec.a = min(1.0, sunSpec.a / SUN_SPEC_FADING_THRESHOLD);

    // specular
    vec3 viewReflectDir = reflect(viewDir, normal);
    float phongTerm = max(dot(viewReflectDir, sunWorldDir), 0.0);
    float sunSpecular = smoothstep(0.99, 0.995, phongTerm) * SPEC_BRIGHTNESS;
    sunSpecular = clamp(sunSpecular, 0.0, 1.0) * shadow * sunSpec.a;

    float skyBrightness = (sunSpec.r + sunSpec.g + sunSpec.b) / 3.0;
    float pointSpecDampen = 1.0 - skyBrightness * 0.8;
    vec3 pointSpecular = doWaterSpecularLighting(gl_FragCoord.xy, (gl_ModelViewMatrix * vec4(position.xyz, 1.0)).xyz, normalize(gl_NormalMatrix * (normal)), pointSpecDampen * pointSpecDampen) * 6.0;

    vec3 combinedSpecular = (sunSpecular * sunSpec.rgb + pointSpecular);

    // posterized sheen effect
    float darken = smoothstep(0.2, 0.1, posterize);
    vec3 baseColor = mix(WATER_COLOR * (1.0 - darken * 0.3) * sun.ambient.xyz, reflection, 0.1);
    vec3 sheenColor = mix(SHEEN_COLOR * sunSpec.xyz, reflection, 0.4);

    float sheenStep = (smoothstep(0.45, 0.55, posterize) + smoothstep(0.85, 1.0, posterize)) * mix(gradient, 1.0, 0.4);

    float sheenTransparency = 1.0 - clamp(sheenStep * 0.3, 0.0, 1.0);
    float baseTransparency = 1.0 - clamp(0.4 + gradient * 1.3, 0.0, 1.0);

    float waterOpacity = 1.0 - baseTransparency * sheenTransparency;

    vec3 surface = mix(sheenColor, baseColor, sheenTransparency);

#if @waterRefraction
    vec3 fogColor = WATER_COLOR * sun.ambient.xyz * 0.5;

    // refraction
    vec3 refraction = sampleRefractionMap(screenCoords - screenCoordsOffset * REFR_BUMP * shoreOffset).rgb;
    vec3 rawRefraction = refraction;

    // brighten up the refraction underwater
    if (cameraPos.z < 0.0)
        refraction = clamp(refraction * 1.5, 0.0, 1.0);
    else {
        vec4 visibilityExp = clamp(pow(VISIBILITY, vec4(waterDepthDistorted * 0.0012)), 0.0, 1.0);
        refraction = mix(fogColor, refraction * visibilityExp.rgb, visibilityExp.a);
    }

    combinedSpecular *= 0.45 + gradient;

    gl_FragData[0].rgb = mix(refraction, surface, waterOpacity);
    gl_FragData[0].a = 1.0;
#else
    gl_FragData[0].rgb = surface;
    gl_FragData[0].a = waterOpacity + length(combinedSpecular) * gradient;
#endif

    gl_FragData[0].rgb += combinedSpecular;

#if @waterRefraction && @wobblyShores
    gl_FragData[0].rgb = mix(rawRefraction, gl_FragData[0].rgb, shoreOffset);
#endif

#if @radialFog
    float radialDepth = distance(position.xyz, cameraPos);
#else
    float radialDepth = 0.0;
#endif

    gl_FragData[0] = applyFogAtDist(gl_FragData[0], radialDepth, linearDepth, far);

#if !@disableNormals
    gl_FragData[1].rgb = normalize(gl_NormalMatrix * normal) * 0.5 + 0.5;
#endif

    applyShadowDebugOverlay();
}
