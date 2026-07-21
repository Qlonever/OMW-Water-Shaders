#version 120

#if @useGPUShader4
    #extension GL_EXT_gpu_shader4: require
#endif

#include "lib/core/fragment.h.glsl"

// Inspired by Blender GLSL Water by martinsh ( https://devlog-martinsh.blogspot.de/2012/07/waterundewater-shader-wip.html )

// tweakables -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --

const vec4 VISIBILITY = vec4(0.65, 0.93, 0.97, 0.2);    // RGB light extinction + fog exponents

const float WAVE_STRENGTH = 1.7;                        // wave intensity
const float RAIN_WAVE_STRENGTH = 6.5;                   // intensity of extra waves added during rain

const float WAVE_SCALE = 6.0;                           // overall wave scale
const float WAVE_SPEED = 0.02;                          // overall wave speed

const float REFL_BUMP = 1.0;                            // reflection distortion amount
const float REFR_BUMP = 0.15;                           // refraction distortion amount

const float RAIN_RIPPLE_STRENGTH = 2.2;                 // strength of normals from rain ripples
const float ACTOR_RIPPLE_STRENGTH = 1.5;                // strength of normals from actor ripples

#if @sunlightScattering
const float SCATTER_AMOUNT = 0.3;                       // amount of sunlight scattering
const vec3 SCATTER_COLOUR = vec3(0.0,1.0,0.95);         // colour of sunlight scattering
const vec3 SUN_EXT = vec3(0.45, 0.55, 0.68);            // sunlight extinction
#endif

const float SUN_SPEC_FADING_THRESHOLD = 0.15;           // visibility at which sun specularity starts to fade
const float SPEC_HARDNESS = 256.0;                      // specular highlights hardness
const float SPEC_BUMPINESS = 4.0;                       // surface bumpiness boost for specular
const float SPEC_BRIGHTNESS = 2.0;                      // boosts the brightness of the specular highlights

const float BUMP_SUPPRESS_DEPTH = 300.0;                // at what water depth bumpmap will be suppressed for reflections and refractions (prevents artifacts at shores)

const vec3 WATER_COLOR = vec3(0.09, 0.11, 0.12);        // refraction fog color / surface tint if refraction is off

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
    float distortionLevel = 2.0;
    vec2 actorRipple = texture2D(rippleMap, rippleMapUV).ba * ACTOR_RIPPLE_STRENGTH * blendFar * blendClose;

    vec4 rainRipple;

    if (rainIntensity > 0.01) {
        height += (heightSamples(UV, 0.8, vec2(-0.19,  0.12), waterTimer, mat2( 1,  0,  0,  1)).xyzw * rainIntensity
                +  heightSamples(UV, 0.8, vec2( 0.09, -0.18), waterTimer, mat2( 0,  1, -1,  0)).wxyz * rainIntensity)
                * RAIN_WAVE_STRENGTH;
        rainRipple = rainCombined(position.xy * 0.001 + actorRipple * 0.01, waterTimer) * RAIN_RIPPLE_STRENGTH * clamp(rainIntensity, 0.0, 1.0) * clamp(1.2 - linearDepth * 0.0003, 0.0, 1.0);
    } else
        rainRipple = vec4(0.0);

    vec3 normal = normalize(vec3((height.zw - height.xy + actorRipple + rainRipple.xy) * clamp(linearDepth * 0.01, 0.5, 1.0), 1.0));

    vec3 sunWorldDir = normalize((gl_ModelViewMatrixInverse * sun.position).xyz);
    vec3 cameraPos = (gl_ModelViewMatrixInverse * vec4(0,0,0,1)).xyz;
    vec3 viewDir = normalize(position.xyz - cameraPos.xyz);

    float sunFade = length(sun.ambient.xyz);

    if (cameraPos.z < 0.0)
        normal *= -1.0;

    // fresnel
    float ior = (cameraPos.z>0.0)?(1.333/1.0):(1.0/1.333); // air to water; water to air
    float fresnel = clamp(fresnel_dielectric(viewDir, normal, ior), 0.0, 1.0);

    // I think this is basically a fixed-length raymarch
    vec3 reflectVec = reflect(viewDir, normal) * vec3(1000.0, 1000.0, -1000.0);
    vec3 reflectCoords = (gl_ModelViewProjectionMatrix * vec4(position.xyz + reflectVec, 1.0)).xyz;

    vec2 screenCoordsOffset = reflectCoords.xy/reflectCoords.zz * 0.5 + vec2(0.5) - screenCoords.xy;
#if @waterRefraction
    float depthSample = linearizeDepth(sampleRefractionDepthMap(screenCoords), near, far);
    float surfaceDepth = linearDepth;
    float realWaterDepth = depthSample - surfaceDepth;  // undistorted water depth in view direction, independent of frustum
    screenCoordsOffset *= clamp(realWaterDepth / BUMP_SUPPRESS_DEPTH, 0.0, 1.0);
    float depthSampleDistorted = linearizeDepth(sampleRefractionDepthMap(screenCoords - screenCoordsOffset * REFR_BUMP), near, far);
    float waterDepthDistorted = max(depthSampleDistorted - surfaceDepth, 0.0);
#endif
    // reflection
    vec3 reflection = sampleReflectionMap(screenCoords + screenCoordsOffset * REFL_BUMP).rgb;

    vec3 waterColor = WATER_COLOR * sunFade;

    vec4 sunSpec = sun.specular;
    // alpha component is sun visibility; we want to start fading lighting effects when visibility is low
    sunSpec.a = min(1.0, sunSpec.a / SUN_SPEC_FADING_THRESHOLD);

    // specular
    const float SPEC_MAGIC = 1.55; // from the original blender shader, changing it makes the spec vanish or become too bright

    vec3 specNormal = normalize(vec3(normal.x * SPEC_BUMPINESS, normal.y * SPEC_BUMPINESS, normal.z));
    vec3 viewReflectDir = reflect(viewDir, specNormal);
    float phongTerm = max(dot(viewReflectDir, sunWorldDir), 0.0);
    float specular = pow(atan(phongTerm * SPEC_MAGIC), SPEC_HARDNESS) * SPEC_BRIGHTNESS;
    specular = clamp(specular, 0.0, 1.0) * shadow * sunSpec.a;
    
    // simple, non-distorting water ripples
    vec3 skyColorEstimate = vec3(max(0.0, mix(-0.3, 1.0, sunFade)));
    vec3 simpleRain = abs(rainRipple.w)*mix(skyColorEstimate, vec3(1.0), 0.05)*0.5;

    float waterTransparency = clamp(fresnel * 6.0 + specular, 0.0, 1.0);

#if @waterRefraction
    // refraction
    vec3 refraction = sampleRefractionMap(screenCoords - screenCoordsOffset * REFR_BUMP).rgb;
    vec3 rawRefraction = refraction;

    // brighten up the refraction underwater
    if (cameraPos.z < 0.0)
        refraction = clamp(refraction * 1.5, 0.0, 1.0);
    else
    {
        vec4 visibilityExp = clamp(pow(VISIBILITY, vec4(waterDepthDistorted * 0.0012)), 0.0, 1.0);
        refraction = mix(waterColor, refraction * visibilityExp.rgb, visibilityExp.a);
    }

#if @sunlightScattering
    vec3 scatterNormal = normal;
    scatterNormal = vec3(-scatterNormal.xy, scatterNormal.z);
    float sunHeight = sunWorldDir.z;
    vec3 scatterColour = mix(SCATTER_COLOUR * vec3(1.0, 0.4, 0.0), SCATTER_COLOUR, max(1.0 - exp(-sunHeight * SUN_EXT), 0.0));
    float scatterLambert = max(dot(sunWorldDir, scatterNormal) * 0.7 + 0.3, 0.0);
    float scatterReflectAngle = max(dot(reflect(sunWorldDir, scatterNormal), viewDir) * 2.0 - 1.2, 0.0);
    float lightScatter = scatterLambert * scatterReflectAngle * SCATTER_AMOUNT * sunFade * sunSpec.a * max(1.0 - exp(-sunHeight), 0.0);
    refraction = mix(refraction, scatterColour, lightScatter);
#endif

    gl_FragData[0].rgb = mix(refraction, reflection, fresnel);
    gl_FragData[0].a = 1.0;
    // no alpha here, so make sure simple rain ripples get properly subdued
    simpleRain *= waterTransparency;
#else
    gl_FragData[0].rgb = mix(waterColor, reflection, (1.0 + fresnel) * 0.5);
    gl_FragData[0].a = waterTransparency;
#endif

    vec3 pointSpecular = doSpecularLighting(gl_FragCoord.xy, (gl_ModelViewMatrix * vec4(position.xyz, 1.0)).xyz, normalize(gl_NormalMatrix * (specNormal * vec3(1.7, 1.7, 1.0))));
    pointSpecular *= SPEC_BRIGHTNESS;

    gl_FragData[0].rgb += specular * sunSpec.rgb + simpleRain + pointSpecular;

#if @waterRefraction && @wobblyShores
    // wobbly water: hard-fade into refraction texture at extremely low depth, with a wobble based on heightmap
    float viewFactor = mix(abs(viewDir.z), 1.0, 0.2);
    float verticalWaterDepth = realWaterDepth * viewFactor; // an estimate
    float shoreOffset = (verticalWaterDepth - (0.5 + height.r * 0.16) * 40.0) * 4.0 + 80.0;
    float fuzzFactor = min(1.0, 1000.0 / surfaceDepth) * viewFactor;
    shoreOffset *= fuzzFactor;
    shoreOffset = clamp(mix(shoreOffset, 1.0, clamp(linearDepth / WOBBLY_SHORE_FADE_DISTANCE, 0.0, 1.0)), 0.0, 1.0);
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