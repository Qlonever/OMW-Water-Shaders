#version 120

#if @useUBO
    #extension GL_ARB_uniform_buffer_object : require
#endif

#if @useGPUShader4
    #extension GL_EXT_gpu_shader4: require
#endif

#include "lib/core/fragment.h.glsl"

// This is a heavily modified version of OpenMW 0.49's water shader
// Which is inspired by Blender GLSL Water by martinsh ( https://devlog-martinsh.blogspot.de/2012/07/waterundewater-shader-wip.html )

// tweakables -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --

const float WAVE_STRENGTH = 6.0;                            // wave intensity
const float RAIN_WAVE_STRENGTH = 8.0;                       // intensity of extra waves added during rain

const float WAVE_SCALE = 14.0;                              // overall wave scale
const float WAVE_SPEED = 0.035;                             // overall wave speed

const float REFL_BUMP = 0.4;                                // reflection distortion amount
const float REFR_BUMP = 0.05;                               // refraction distortion amount

const float RAIN_RIPPLE_STRENGTH = 3.0;                     // strength of normals from rain ripples
const float ACTOR_RIPPLE_STRENGTH = 4.0;                    // strength of normals from actor ripples

const bool DISTORT_RAYMETHOD = true;                        // whether to distort reflections using a more realistic ray-based method or in a more Morrowind-y way
const vec2 DISTORT_SHARP = vec2(0.2, 0.2);                  // distortion multiplier at sharp viewing angles

const float SUN_SPEC_FADING_THRESHOLD = 1.0;                // visibility at which sun specularity starts to fade
const float SPEC_HARDNESS = 128.0;                          // specular highlights hardness

const float BUMP_SUPPRESS_DEPTH = 300.0;                    // at what water depth bumpmap will be suppressed for reflections and refractions (prevents artifacts at shores)

const vec3 ENV_REDUCE_COLOR = vec3(255, 255, 255) / 255;    // value from Morrowind.ini, tint color for reflection
const vec3 LERP_CLOSE_COLOR = vec3(37, 46, 48) / 255;       // value from Morrowind.ini, fade color for reflection below the camera
const vec3 BUMP_FADE_COLOR = vec3(230, 239, 255) / 255;     // value from Morrowind.ini, water normal multiplier before fresnel calculation
const float ALPHA_REDUCE = 0.35;                            // value from Morrowind.ini, overall transparency reduction value

const float LERP_CLOSE_INTENSITY = 1.0;                     // intensity of reflection fade
const float LERP_CLOSE_AMBIENT = 1.0;                       // influence of ambient light over reflection fade color
const vec3 BASE_AMBIENT = 255 / vec3(137, 140, 160);        // base ambient value under which fade color won't be influenced

#if @wobblyShores
const float WOBBLY_SHORE_FADE_DISTANCE = 6200.0;            // fade out wobbly shores to mask precision errors, the effect is almost impossible to see at a distance
#endif

// -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -

uniform sampler2D rippleMap;

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

#include "shadows_fragment.glsl"
#include "lib/light/lighting.glsl"
#include "fog.glsl"
#include "lib/water/rain_ripples.glsl"
#include "lib/view/depth.glsl"

void main(void)
{
    vec2 UV = worldPos.xy * 0.00008;

    vec2 screenCoords = gl_FragCoord.xy / screenRes;

    vec3 sunWorldDir = normalize((gl_ModelViewMatrixInverse * vec4(lcalcPosition(0).xyz, 0.0)).xyz);
    vec3 cameraPos = (gl_ModelViewMatrixInverse * vec4(0.0,0.0,0.0,1.0)).xyz;
    vec3 viewDir = normalize(position.xyz - cameraPos.xyz);

    float radialDepth = distance(position.xyz, cameraPos);

    #define waterTimer osg_SimulationTime

    vec4 height = (heightSamples(UV, 1.0,  vec2( 0.02,  0.08), waterTimer, mat2( 1,  0,  0,  1)).xyzw * 1.0
                +  heightSamples(UV, 0.8,  vec2( 0.06, -0.05), waterTimer, mat2( 0,  1, -1,  0)).wxyz * 1.0
                +  heightSamples(UV, 0.9,  vec2(-0.09,  0.03), waterTimer, mat2(-1,  0,  0, -1)).zwxy * 1.0
                +  heightSamples(UV, 1.2,  vec2(-0.05, -0.07), waterTimer, mat2( 0, -1,  1,  0)).yzwx * 1.0)
                * WAVE_STRENGTH;

    float distToCenter = length(rippleMapUV - vec2(0.5));
    float blendClose = smoothstep(10, 60, linearDepth);
    float blendFar = 1.0 - smoothstep(0.3, 0.4, distToCenter);
    vec2 actorRipple = texture2D(rippleMap, rippleMapUV).ba * ACTOR_RIPPLE_STRENGTH * blendFar * blendClose;

    vec4 rainRipple;

    if (rainIntensity > 0.01) {
        height += (heightSamples(UV, 0.6, vec2(-0.12,  0.07), waterTimer, mat2( 1,  0,  0,  1)).xyzw * rainIntensity
                +  heightSamples(UV, 0.6, vec2( 0.05, -0.11), waterTimer, mat2( 0,  1, -1,  0)).wxyz * rainIntensity)
                * RAIN_WAVE_STRENGTH;
        rainRipple = rainCombined(position.xy * 0.001 + actorRipple * 0.01, waterTimer) * RAIN_RIPPLE_STRENGTH * clamp(rainIntensity, 0.0, 1.0) * clamp(1.2 - linearDepth * 0.0003, 0.0, 1.0);
    } else
        rainRipple = vec4(0.0);

    vec3 normal = normalize(vec3((height.zw - height.xy + actorRipple + rainRipple.xy) * clamp(linearDepth * 0.01, 0.5, 1.0), 1.0));

    if (cameraPos.z < 0.0)
        normal = -normal;

    vec2 distortMult = vec2(1.0);
    vec2 screenCoordsOffset;

    if (DISTORT_RAYMETHOD) {
        // I think this is basically a fixed-length raymarch
        vec3 reflectVec = reflect(viewDir, normal) * vec3(1000.0, 1000.0, -1000.0);
        vec3 reflectCoords = (gl_ModelViewProjectionMatrix * vec4(position.xyz + reflectVec, 1.0)).xyz;

        screenCoordsOffset = reflectCoords.xy/reflectCoords.zz * 0.5 + vec2(0.5) - screenCoords.xy;
    } else {
        distortMult = mix(DISTORT_SHARP, vec2(1.0), vec2(abs(viewDir.z)));
        // align normal x-axis with viewspace x-axis before doing distortion sampling
        // this would break if the player could look precisely up or down
        vec2 viewAxis = normalize((gl_ModelViewMatrixInverse * vec4(1.0, 0.0, 0.0, 0.0)).xy);
        mat2 rotateMatrix = mat2(viewAxis, vec2(-viewAxis.y, viewAxis.x));

        screenCoordsOffset = normal.xy * rotateMatrix * distortMult;
    }

    // this makes almost no visible difference with default values, but Morrowind does it
    normal *= BUMP_FADE_COLOR;

    // replicate Morrowind's fresnel, which calculates inverse alpha
    float normalDot = 0.5 * dot(-viewDir, normal) + 0.5;
    float fresnel = 1.0 - clamp(normalDot * normalDot - ALPHA_REDUCE, 0.0, 1.0);

    // simple rain ripples
    vec3 simpleRain = vec3(rainRipple.w * length(gl_LightModel.ambient.xyz) * 0.08);

    vec4 sunSpec = lcalcSpecular(0);
    // alpha component is sun visibility; we want to start fading lighting effects when visibility is low
    sunSpec.a = min(1.0, sunSpec.a / SUN_SPEC_FADING_THRESHOLD);

    // not really specular, just sun reflection
    float sunDisk = clamp(dot(reflect(viewDir, normalize(vec3(normal.xy * distortMult * REFL_BUMP, normal.z))), sunWorldDir), 0.0, 1.0);
    float sunFade = sunSpec.a * (2 - sunWorldDir.z);
    vec3 specular = pow(sunDisk, SPEC_HARDNESS) * sunFade * sunSpec.rgb;

#if @waterRefraction
    float depthSample = linearizeDepth(sampleRefractionDepthMap(screenCoords), near, far);
    float surfaceDepth = linearizeDepth(gl_FragCoord.z, near, far);
    float realWaterDepth = depthSample - surfaceDepth;  // undistorted water depth in view direction, independent of frustum
    screenCoordsOffset *= clamp(realWaterDepth / BUMP_SUPPRESS_DEPTH, 0.0, 1.0);

    // refraction
    vec3 refraction = sampleRefractionMap(screenCoords - screenCoordsOffset * REFR_BUMP).rgb;
#endif

    // reflection
    vec3 waterColor = LERP_CLOSE_COLOR;
    waterColor *= mix(vec3(1.0), gl_LightModel.ambient.xyz * BASE_AMBIENT, LERP_CLOSE_AMBIENT);

    vec3 reflection = sampleReflectionMap(screenCoords + screenCoordsOffset * REFL_BUMP).rgb;
    reflection = min(reflection + specular, vec3(1.0)) * ENV_REDUCE_COLOR;
    reflection = mix(reflection, waterColor, abs(viewDir.z) * LERP_CLOSE_INTENSITY) + simpleRain;

#if @waterRefraction

#if @wobblyShores
    // wobbly water: hard-fade into refraction texture at extremely low depth, with a wobble based on normal mapping
    float viewFactor = mix(abs(viewDir.z), 1.0, 0.2);
    float verticalWaterDepth = realWaterDepth * viewFactor; // an estimate
    float shoreOffset = (verticalWaterDepth - (0.5 - height.r * 0.04) * 32.0) * 6.0 + 80.0;
    float fuzzFactor = min(1.0, 1000.0 / surfaceDepth) * viewFactor;
    shoreOffset *= fuzzFactor;
    shoreOffset = clamp(mix(shoreOffset, 1.0, clamp(linearDepth / WOBBLY_SHORE_FADE_DISTANCE, 0.0, 1.0)), 0.0, 1.0);
    fresnel *= shoreOffset;
#endif

    gl_FragData[0].rgb = mix(refraction, reflection, fresnel);
    gl_FragData[0].a = 1.0;
#else
    gl_FragData[0].rgb = reflection;
    gl_FragData[0].a = fresnel;
#endif

    gl_FragData[0] = applyFogAtDist(gl_FragData[0], radialDepth, linearDepth, far);

#if !@disableNormals
    gl_FragData[1].rgb = normalize(gl_NormalMatrix * normal) * 0.5 + 0.5;
#endif

    applyShadowDebugOverlay();
}